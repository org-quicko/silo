import fs from "fs/promises";
import { Claims } from "@silo/shared/claims";
import path from "path";
import os from "os";
import { x } from "tar";
import type { Storage } from "../ports/storage";
import type { BlobStorage } from "../ports/blob-storage";
import { FsBlobStorage } from "../../adapters/blob/fs-blob-storage";
import { EntryUtils } from "../domain/entry-utils";
import type { Meta } from "../domain/meta";
import { ValidationError } from "@silo/shared/validation-error";
import { NotFoundError } from "../errors/not-found-error";
import { MediaRefs } from "../media/media-refs";
import { SearchText } from "../search/search-text";
import { ForbiddenError } from "../errors/forbidden-error";
import { SchemaValidator } from "../schema/schema-validator";
import { FormatVersion } from "./format-version";
import type { ExportManifest } from "./export-manifest";
import { ImportWalker, type ScopedImport } from "./import-walker";
import { KeyUtils } from "../keys/key-utils";
import type { ImportOptions } from "./import-options";
import type { ImportResult } from "./import-result";

export interface ParsedImport {
  manifest: ExportManifest;
  scopes: ScopedImport[];
}

export class Importer {
  private static async parseImportDir(src: string): Promise<ParsedImport> {
    const manifestPath = path.join(src, "manifest.json");
    const mdata = await fs.readFile(manifestPath, "utf8");
    const manifest = JSON.parse(mdata) as ExportManifest;

    const v = manifest.format_version;
    if (v !== FormatVersion) {
      throw new ValidationError(
        `unsupported export format_version "${v}" (this silo understands "${FormatVersion}"); upgrade silo or re-export from a compatible version`
      );
    }

    const scopes = await ImportWalker.walkProjects(src);
    return { manifest, scopes };
  }

  static async executeImport(
    store: Storage,
    pi: ParsedImport,
    opts: ImportOptions
  ): Promise<ImportResult> {
    const mode = opts.mode || "merge";
    if (mode !== "merge" && mode !== "replace") {
      throw new ValidationError(`invalid import mode "${mode}"`);
    }

    const response: ImportResult = {
      mode,
      dry_run: !!opts.dryRun,
      added: 0,
      updated: 0,
      deleted: 0,
      skipped: 0,
    };

    const localMeta = await store.meta();
    let validator: SchemaValidator | undefined;
    if (opts.validate) {
      validator = new SchemaValidator(store);
    }

    for (const scoped of pi.scopes) {
      await Importer.executeScopedImport(store, scoped, pi.manifest, localMeta, mode, opts, response, validator);
    }

    return response;
  }

  // Replace mode deletes only the collections present in the archive **for
  // this scope** — a same-named collection in another scope is untouched
  // (D18). Merge/replace/prefer/dry-run semantics are otherwise unchanged
  // from the pre-scoping importer, just applied per (scope, collection).
  private static async executeScopedImport(
    store: Storage,
    scoped: ScopedImport,
    manifest: ExportManifest,
    localMeta: Meta,
    mode: "merge" | "replace",
    opts: ImportOptions,
    response: ImportResult,
    validator: SchemaValidator | undefined
  ): Promise<void> {
    const { scope, schemas, entries } = scoped;

    if (!scope.isSystem() && !opts.dryRun) {
      await store.createProject(scope.project);
      await store.createEnvironment(scope.project, scope.env);
    }

    if (mode === "replace") {
      const replaceCollections = new Set([...schemas.keys(), ...entries.keys()]);
      for (const colName of replaceCollections) {
        try {
          const { total } = await store.list(scope, colName, { limit: 1, offset: 0 });
          response.deleted += total;

          if (!opts.dryRun) {
            let entriesLeft = total;
            while (entriesLeft > 0) {
              const { items } = await store.list(scope, colName, { limit: 100, offset: 0 });
              if (items.length === 0) break;
              for (const e of items) {
                await store.delete(scope, colName, e.id);
              }
              entriesLeft -= items.length;
            }
            await store.deleteSchema(scope, colName).catch(() => {});
          }
        } catch (caught: any) {
          if (!(caught instanceof NotFoundError)) {
            throw caught;
          }
        }
      }
    }

    // Import schemas
    for (const [colName, remoteSchema] of schemas.entries()) {
      try {
        const localSchema = await store.getSchema(scope, colName);
        if (mode === "merge") {
          if (JSON.stringify(localSchema) !== JSON.stringify(remoteSchema)) {
            if (opts.prefer === "local") {
              continue;
            }
            if (!opts.dryRun) {
              await store.putSchema(scope, colName, remoteSchema);
            }
          }
        } else {
          if (!opts.dryRun) {
            await store.putSchema(scope, colName, remoteSchema);
          }
        }
      } catch (caught: any) {
        if (caught instanceof NotFoundError) {
          if (!opts.dryRun) {
            await store.putSchema(scope, colName, remoteSchema);
          }
        } else {
          throw caught;
        }
      }
    }

    if (validator) {
      validator.invalidate();
    }

    // Import entries
    for (const [colName, remoteEntries] of entries.entries()) {
      const colValidator = EntryUtils.isSystemCollection(colName) ? undefined : validator;
      // Schemas for this scope are already written above, so the collection's
      // own schema is what `x-silo-search` should be read from — fetched once
      // per collection rather than once per entry. System collections index
      // nothing at all (D30).
      const isSystem = EntryUtils.isSystemCollection(colName);
      let colSchema: any;
      if (!isSystem) {
        try {
          colSchema = await store.getSchema(scope, colName);
        } catch (caught) {
          if (!(caught instanceof NotFoundError)) throw caught;
        }
      }
      const derived = (data: any) => ({
        usages: MediaRefs.extract(data),
        search: isSystem ? null : SearchText.extract(data, colSchema),
      });
      for (const remote of remoteEntries) {
        if (mode === "replace") {
          response.added++;
          if (!opts.dryRun) {
            if (colValidator) {
              await colValidator.validateEntry(scope, colName, remote.data);
            }
            await store.put(remote, derived(remote.data));
          }
          continue;
        }

        // Merge mode
        try {
          const local = await store.get(scope, colName, remote.id);
          let win = false;
          if (opts.prefer === "local") {
            win = false;
          } else if (opts.prefer === "remote") {
            win = true;
          } else {
            const remoteTime = remote.updated_at.getTime();
            const localTime = local.updated_at.getTime();
            if (remoteTime > localTime) {
              win = true;
            } else if (localTime > remoteTime) {
              win = false;
            } else {
              if (remote.rev > local.rev) {
                win = true;
              } else if (local.rev > remote.rev) {
                win = false;
              } else {
                win = manifest.instance_id > localMeta.instance_id;
              }
            }
          }

          if (win) {
            response.updated++;
            if (!opts.dryRun) {
              if (colValidator) {
                await colValidator.validateEntry(scope, colName, remote.data);
              }
              await store.put(remote, derived(remote.data));
            }
          } else {
            response.skipped++;
          }
        } catch (caught: any) {
          if (caught instanceof NotFoundError) {
            response.added++;
            if (!opts.dryRun) {
              if (colValidator) {
                await colValidator.validateEntry(scope, colName, remote.data);
              }
              await store.put(remote, derived(remote.data));
            }
          } else {
            throw caught;
          }
        }
      }
    }
  }

  static async importDir(
    store: Storage,
    src: string,
    opts: ImportOptions,
    blobStorage?: BlobStorage | string
  ): Promise<ImportResult> {
    const pi = await Importer.parseImportDir(src);
    const hasKeys = pi.scopes.some((s) => s.entries.has(KeyUtils.KeysCollection));
    if (hasKeys && opts.allowKeys !== true) {
      throw new ForbiddenError(
        `import contains API keys but this key is missing claim "${Claims.KeysImport}"`,
      );
    }
    const response = await Importer.executeImport(store, pi, opts);

    if (blobStorage && !opts.dryRun) {
      const bStore: BlobStorage =
        typeof blobStorage === "string" ? new FsBlobStorage(blobStorage) : blobStorage;
      const srcMediaDir = path.join(src, "media");
      try {
        const stat = await fs.stat(srcMediaDir);
        if (stat.isDirectory()) {
          if (opts.mode === "replace") {
            const existingBlobs = await bStore.list();
            for (const item of existingBlobs) {
              await bStore.delete(item.key);
            }
          }

          const files = await fs.readdir(srcMediaDir);
          for (const file of files) {
            if (!file.startsWith(".")) {
              const srcFile = path.join(srcMediaDir, file);
              if (opts.mode !== "replace") {
                const exists = await bStore.exists(file);
                if (exists) continue;
              }
              const fileData = await fs.readFile(srcFile);
              await bStore.put(file, new Uint8Array(fileData));
            }
          }
        }
      } catch (caught: any) {
        if (caught.code !== "ENOENT") throw caught;
      }
    }

    return response;
  }

  static async importTarGz(
    store: Storage,
    tarballPathOrBuffer: string | Buffer,
    opts: ImportOptions,
    blobStorage?: BlobStorage | string
  ): Promise<ImportResult> {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-import-"));
    try {
      if (typeof tarballPathOrBuffer === "string") {
        await x({
          file: tarballPathOrBuffer,
          cwd: tmpDir,
        });
      } else {
        const tmpTar = path.join(tmpDir, "import.tar.gz");
        await fs.writeFile(tmpTar, tarballPathOrBuffer);
        await x({
          file: tmpTar,
          cwd: tmpDir,
        });
        await fs.rm(tmpTar);
      }
      return await Importer.importDir(store, tmpDir, opts, blobStorage);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }
}
