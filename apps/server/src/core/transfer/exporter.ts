import fs from "fs/promises";
import path from "path";
import os from "os";
import { c } from "tar";
import type { Storage } from "../ports/storage";
import type { BlobStorage } from "../ports/blob-storage";
import { FsBlobStorage } from "../../adapters/blob/fs-blob-storage";
import { EntryUtils } from "../domain/entry-utils";
import { Scope } from "../domain/scope";
import { KeyUtils } from "../keys/key-utils";
import { MediaCatalog } from "../media/media-catalog";
import { FormatVersion } from "./format-version";
import { SiloVersion } from "../../version";
import type { ExportOptions } from "./export-options";
import type { ExportManifest } from "./export-manifest";

export class Exporter {
  // System collections stay out of the archive; `_keys` is the one exception
  // and only behind --with-keys. Registered-but-empty projects need no
  // collection of their own to survive a round trip: `listScopes()` reports
  // them (D20 — a scope exists once it is created, not only once it holds
  // content), `exportScope` writes the empty `projects/<p>/<e>/` directory,
  // and `ImportWalker` recreates the pair from it.
  private static skipCollection(name: string, withKeys?: boolean): boolean {
    if (name.startsWith("_")) {
      // The media catalog is data, not a credential (D23): an archive that
      // carried the bytes without their filenames and folders would restore a
      // library with no organisation in it, so `_media`/`_media_folders` are
      // never gated on --with-keys the way `_keys` is.
      if (name === MediaCatalog.Collection || name === MediaCatalog.FoldersCollection) {
        return false;
      }
      return name !== KeyUtils.KeysCollection || !withKeys;
    }
    return false;
  }

  private static async exportEntries(store: Storage, dest: string, scope: Scope, colName: string): Promise<number> {
    const colDir = path.join(dest, "projects", scope.project, scope.env, "content", colName);
    // Created on first write, not up front, so a collection that turns out to
    // hold nothing leaves no empty directory behind in the archive.
    let dirReady = false;

    let offset = 0;
    let count = 0;
    while (true) {
      const { items } = await store.list(scope, colName, {
        sort: [{ path: "$.id", desc: false }],
        limit: 100,
        offset,
      });

      if (items.length === 0) {
        break;
      }

      for (const e of items) {
        const ej = {
          id: e.id,
          project: e.project,
          env: e.env,
          collection: e.collection,
          rev: e.rev,
          seq: e.seq,
          created_at: e.created_at instanceof Date ? e.created_at.toISOString() : e.created_at,
          updated_at: e.updated_at instanceof Date ? e.updated_at.toISOString() : e.updated_at,
          data: e.data,
        };

        const dataStr = JSON.stringify(ej, null, 2);
        if (!dirReady) {
          await fs.mkdir(colDir, { recursive: true });
          dirReady = true;
        }
        await fs.writeFile(path.join(colDir, `${e.id}.json`), dataStr, "utf8");
        count++;
      }

      offset += items.length;
    }
    return count;
  }

  // Exports one scope: every collection it holds, and — for a scope that was
  // created but holds nothing yet — the bare `projects/<p>/<e>/` directory,
  // which is what carries its existence across a round trip.
  private static async exportScope(
    store: Storage,
    dest: string,
    scope: Scope,
    withKeys: boolean | undefined,
    colCounts: Record<string, number>
  ): Promise<void> {
    const schemas = await store.listSchemas(scope);
    // Entries are enumerated independently of schemas, not derived from them.
    // Two kinds of collection have entries and no schema and would otherwise
    // be dropped from every archive: the system collections (`_keys`), and
    // any collection a previous import created from a `content/<name>/`
    // directory that had no `schemas/` counterpart. `skipCollection` still
    // decides what is *allowed* out, so `_keys` stays behind --with-keys.
    const contentCols = [
      ...new Set([...schemas.keys(), ...(await store.listEntryCollections(scope))]),
    ]
      .filter((n) => !Exporter.skipCollection(n, withKeys))
      .sort();

    if (!scope.isSystem()) {
      await fs.mkdir(path.join(dest, "projects", scope.project, scope.env), { recursive: true });
    }

    for (const colName of contentCols) {
      colCounts[`${scope.key()}/${colName}`] = await Exporter.exportEntries(store, dest, scope, colName);
    }

    for (const [colName, schema] of schemas.entries()) {
      if (Exporter.skipCollection(colName, withKeys)) {
        continue;
      }
      const schemaPath = path.join(dest, "projects", scope.project, scope.env, "schemas", `${colName}.schema.json`);
      await fs.mkdir(path.dirname(schemaPath), { recursive: true });
      await fs.writeFile(schemaPath, JSON.stringify(schema, null, 2), "utf8");
    }
  }

  static async exportDir(
    store: Storage,
    dest: string,
    opts: ExportOptions,
    blobStorage?: BlobStorage | string
  ): Promise<void> {
    const meta = await store.meta();
    // Content directories are created lazily, so an instance with nothing to
    // export would otherwise reach the manifest write with no dest at all.
    await fs.mkdir(dest, { recursive: true });

    const exportedAt = opts.exportedAt || EntryUtils.now();
    const siloVer = opts.siloVersion || SiloVersion;
    const colCounts: Record<string, number> = {};

    // The system scope is always visited so --with-keys has something to
    // find; `_keys` inside it stays gated on that flag by skipCollection().
    // listScopes() never reports the system scope — system data is opt-in
    // (D18).
    const scopes = [...(await store.listScopes()), Scope.System];

    for (const scope of scopes) {
      await Exporter.exportScope(store, dest, scope, opts.withKeys, colCounts);
    }

    // Copy media files if present
    if (blobStorage) {
      const bStore: BlobStorage =
        typeof blobStorage === "string" ? new FsBlobStorage(blobStorage) : blobStorage;
      try {
        const blobs = await bStore.list();
        if (blobs.length > 0) {
          const mediaDest = path.join(dest, "media");
          await fs.mkdir(mediaDest, { recursive: true });
          for (const blob of blobs) {
            const response = await bStore.get(blob.key);
            if (response) {
              const dest = path.join(mediaDest, blob.key);
              await fs.mkdir(path.dirname(dest), { recursive: true });
              await fs.writeFile(dest, response.data);
            }
          }
        }
      } catch (error: any) {
        if (error.code !== "ENOENT") throw error;
      }
    }

    // Write manifest.json
    const manifest: ExportManifest = {
      format_version: FormatVersion,
      instance_id: meta.instance_id,
      last_seq: meta.last_seq,
      exported_at: exportedAt.toISOString(),
      silo_version: siloVer,
      collections: colCounts,
    };

    await fs.writeFile(
      path.join(dest, "manifest.json"),
      JSON.stringify(manifest, null, 2),
      "utf8"
    );
  }

  static async exportTarGz(
    store: Storage,
    w: any,
    opts: ExportOptions,
    blobStorage?: BlobStorage | string
  ): Promise<void> {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-export-"));
    try {
      await Exporter.exportDir(store, tmpDir, opts, blobStorage);
      const files = await fs.readdir(tmpDir);

      if (typeof w === "string") {
        await c({
          gzip: true,
          cwd: tmpDir,
          file: w,
        }, files);
      } else {
        const tmpTar = path.join(tmpDir, "export.tar.gz");
        await c({
          gzip: true,
          cwd: tmpDir,
          file: tmpTar,
        }, files);

        const tarData = await fs.readFile(tmpTar);
        if (w.write) {
          await w.write(tarData);
        } else if (typeof w === "object" && "write" in w) {
          await w.write(tarData);
        } else {
          throw new Error("unsupported writer type");
        }
      }
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }
}
