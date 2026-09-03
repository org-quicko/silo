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
import { ConflictError } from "../errors/conflict-error";
import { NotFoundError } from "../errors/not-found-error";
import { MediaRefs } from "../media/media-refs";
import { SearchText } from "../search/search-text";
import { ForbiddenError } from "../errors/forbidden-error";
import { SchemaValidator } from "../schema/schema-validator";
import { FormatVersion } from "./format-version";
import type { ExportManifest } from "./export-manifest";
import { ImportWalker, type ImportedProject, type ScopedImport } from "./import-walker";
import { KeyUtils } from "../keys/key-utils";
import type { ImportOptions } from "./import-options";
import type { ImportResult } from "./import-result";

export interface ParsedImport {
  manifest: ExportManifest;
  scopes: ScopedImport[];
  /** Projects the archive names, so one holding no environment survives the
   *  round trip (D51). Absent when the caller built the unit in memory. */
  projects?: ImportedProject[];
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

    const { projects, scopes } = await ImportWalker.walkProjects(src);
    return { manifest, scopes, projects };
  }

  /**
   * Creates a record, preferring the archive's id and falling back to a mint.
   *
   * The conflict matrix in one place (D51). A name that already exists keeps the
   * **destination's** id and the archive's is ignored, because the path is the
   * addressing authority. A name that does not exist takes the archive's id when
   * it is well-formed and free, and a fresh one when the adapter refuses it —
   * two instances that each minted their own `blog` can still exchange archives,
   * which they could not if a duplicate id failed the whole import.
   */
  private static async createRecord<T>(
    create: (id?: string) => Promise<T>,
    id?: string
  ): Promise<void> {
    try {
      await create(id);
    } catch (caught) {
      if (id === undefined || !(caught instanceof ConflictError)) throw caught;
      await create(undefined);
    }
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

    // Projects first, and every project the archive names rather than only the
    // ones a scope mentions: a project with no environment is not a scope, so
    // it would otherwise be dropped (D51). Their ids come from the markers.
    if (!opts.dryRun) {
      for (const project of pi.projects ?? []) {
        if (project.name.startsWith("_")) continue;
        await Importer.createRecord(
          (id) => store.createProject(project.name, id),
          project.id
        );
      }
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
      await Importer.createRecord(() => store.createProject(scope.project));
      await Importer.createRecord(
        (id) => store.createEnvironment(scope.project, scope.env, id),
        scoped.envId
      );
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
            // The schema is **not** deleted. It used to be, and re-put a moment
            // later — which under record keying destroys the collection record
            // and mints a new id for the same collection, losing the identity
            // the destination already had. `putSchema` below replaces the
            // schema in place and keeps it (D51).
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
              await Importer.createRecord(
                (id) => store.putSchema(scope, colName, remoteSchema, id),
                scoped.collectionIds.get(colName)
              );
            }
          }
        } else {
          if (!opts.dryRun) {
            await Importer.createRecord(
              (id) => store.putSchema(scope, colName, remoteSchema, id),
              scoped.collectionIds.get(colName)
            );
          }
        }
      } catch (caught: any) {
        if (caught instanceof NotFoundError) {
          if (!opts.dryRun) {
            await Importer.createRecord(
              (id) => store.putSchema(scope, colName, remoteSchema, id),
              scoped.collectionIds.get(colName)
            );
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

  /**
   * Load an archive that arrives as a stream — an upload body, or another
   * instance's `/api/export` response.
   *
   * An archive carries every media byte, so reading one into a `Buffer` first
   * cost as much memory as the source instance's library and failed a large
   * import outright on a small host. `tar.x` is fed the stream directly: no
   * intermediate `.tar.gz` is written and nothing bigger than one chunk is
   * held, though the *extracted* tree still lands in a temp dir, since
   * `importDir` walks a directory and the archive is not ordered for a
   * single pass.
   */
  static async importTarGzStream(
    store: Storage,
    archive: ReadableStream<Uint8Array>,
    opts: ImportOptions,
    blobStorage?: BlobStorage | string
  ): Promise<ImportResult> {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-import-"));
    try {
      await Importer.extractStream(archive, tmpDir);
      return await Importer.importDir(store, tmpDir, opts, blobStorage);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }

  /**
   * Extract a streamed tarball into `dest`.
   *
   * `tar.x` with no `file` is a writable parser, so this is a pump: write each
   * chunk, wait for `drain` when it asks, and finish on the `end` it emits
   * only once the input has ended *and* every file it opened has been written
   * (its own pending-write count is what guarantees that, so the walk that
   * follows never sees a half-extracted tree).
   *
   * A tar-level failure is recorded rather than raced as a rejection: the pump
   * stops at the next chunk and rethrows it, so a truncated or corrupt upload
   * surfaces as that error instead of an unhandled one.
   */
  private static async extractStream(
    archive: ReadableStream<Uint8Array>,
    dest: string
  ): Promise<void> {
    const unpack = x({ cwd: dest });

    let failure: unknown;
    const finished = new Promise<void>((resolve) => {
      unpack.on("end", () => resolve());
      unpack.on("error", (error: unknown) => {
        failure = error;
        resolve();
      });
    });

    const reader = archive.getReader();
    try {
      for (;;) {
        if (failure) throw failure;
        const { done, value } = await reader.read();
        if (done) break;
        if (!unpack.write(value)) {
          await new Promise<void>((resolve) => unpack.once("drain", () => resolve()));
        }
      }
      unpack.end();
      await finished;
      if (failure) throw failure;
    } finally {
      // A partial read leaves the source open; the extracted tree is the
      // caller's to remove either way.
      await reader.cancel().catch(() => {});
    }
  }

  /**
   * Load an archive from a path, or from a `Buffer` a caller already holds.
   *
   * A path is handed to `tar.x`, which reads it itself. A `Buffer` is already
   * whole in memory, so there is nothing left to stream — it goes through the
   * same extraction as one chunk, which is what removed the temp `.tar.gz`
   * this branch used to write and delete.
   */
  static async importTarGz(
    store: Storage,
    tarballPathOrBuffer: string | Buffer,
    opts: ImportOptions,
    blobStorage?: BlobStorage | string
  ): Promise<ImportResult> {
    if (typeof tarballPathOrBuffer !== "string") {
      const buffer = tarballPathOrBuffer;
      return Importer.importTarGzStream(
        store,
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(buffer);
            controller.close();
          },
        }),
        opts,
        blobStorage
      );
    }

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-import-"));
    try {
      await x({ file: tarballPathOrBuffer, cwd: tmpDir });
      return await Importer.importDir(store, tmpDir, opts, blobStorage);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }
}
