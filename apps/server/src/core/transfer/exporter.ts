import fs from "fs/promises";
import path from "path";
import os from "os";
import { c, type Pack } from "tar";
import type { Storage } from "../ports/storage";
import type { BlobStorage } from "../ports/blob-storage";
import { FsBlobStorage } from "../../adapters/blob/fs-blob-storage";
// The fs layout *is* the archive format (D5), so the archive's file and marker
// names come from the one place that grammar is stated.
import { FsLayout } from "../../adapters/storage/fs/fs-layout";
import { EntryUtils } from "../domain/entry-utils";
import { Scope } from "../domain/scope";
import type { Entry } from "../domain/entry";
import type { KeyInfo } from "../keys/key-info";
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
      if (
        name === MediaCatalog.Collection ||
        name === MediaCatalog.FoldersCollection ||
        // An archive taken mid-rename carries the half-moved subtree either
        // way; carrying its marker too is what lets the destination converge
        // on the same final state the source will reach at its next start
        // (D49), instead of restoring a split no one has a record of.
        name === MediaCatalog.MovesCollection
      ) {
        return false;
      }
      return name !== KeyUtils.KeysCollection || !withKeys;
    }
    return false;
  }

  /**
   * The one case where a collection is exported but an entry inside it is not
   * (D34): a **managed** key.
   *
   * `--with-keys` exists so an instance can be cloned with its credentials
   * intact. A plugin's key is not a credential anyone holds — silo mints it,
   * keeps the secret and rotates it at every start — so carrying it would put a
   * record in the destination that no `_plugins` grant points at, that no
   * operator can revoke through the ordinary path, and that nothing can ever
   * authenticate as. The grant it belongs to is instance-local and is not
   * exported either; the destination mints its own on approval.
   */
  private static skipEntry(colName: string, entry: Entry): boolean {
    if (colName !== KeyUtils.KeysCollection) return false;
    return KeyUtils.isManaged(entry.data as KeyInfo);
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
        if (Exporter.skipEntry(colName, e)) continue;

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
    // One read. Before D51 this was a union with `listEntryCollections`,
    // because a collection could hold entries and have no schema; every
    // collection is a record now, so there is nothing that union would add.
    // `skipCollection` still decides what is *allowed* out, so `_keys` stays
    // behind --with-keys.
    const records = (await store.listCollections(scope))
      .filter((record) => !Exporter.skipCollection(record.name, withKeys))
      .sort((left, right) => left.name.localeCompare(right.name));

    const scopeDir = path.join(dest, "projects", scope.project, scope.env);
    if (!scope.isSystem()) {
      await fs.mkdir(scopeDir, { recursive: true });
      const environment = await store.findEnvironment(scope.project, scope.env);
      if (environment) {
        await Exporter.writeMarker(
          path.join(scopeDir, FsLayout.EnvMarker),
          environment.id,
          environment.created_at
        );
      }
    }

    for (const record of records) {
      colCounts[`${scope.key()}/${record.name}`] = await Exporter.exportEntries(
        store,
        dest,
        scope,
        record.name
      );
    }

    for (const record of records) {
      const schemasDir = path.join(scopeDir, "schemas");
      await fs.mkdir(schemasDir, { recursive: true });
      await fs.writeFile(
        path.join(schemasDir, `${record.name}${FsLayout.SchemaSuffix}`),
        JSON.stringify(record.schema, null, 2),
        "utf8"
      );
      // The collection's id travels beside its schema, so an import can
      // preserve it rather than minting a new one (D51).
      await Exporter.writeMarker(
        path.join(schemasDir, `.${record.name}${FsLayout.CollectionMarkerSuffix}`),
        record.id,
        record.created_at
      );
    }
  }

  /** A record's id, in the same marker shape the fs adapter reads. */
  private static async writeMarker(
    filePath: string,
    id: string,
    createdAt: Date
  ): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(
      filePath,
      JSON.stringify({ id, created_at: createdAt.toISOString() }),
      "utf8"
    );
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

    // Projects first, and every project rather than only those a scope names:
    // `listScopes()` answers (project, env) pairs, so a project holding no
    // environment at all could never appear in it and was silently dropped from
    // every archive (D51). Its marker is also what carries its id.
    for (const project of await store.listProjects()) {
      const projectDir = path.join(dest, "projects", project.name);
      await fs.mkdir(projectDir, { recursive: true });
      await Exporter.writeMarker(
        path.join(projectDir, FsLayout.ProjectMarker),
        project.id,
        project.created_at
      );
    }

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

  /**
   * The tarball, as a stream.
   *
   * `exportDir` copies every media byte into the temp tree, so a
   * whole-instance archive is as large as the media library. Handing that back
   * as one `Buffer` put the whole archive in memory at once, which on a small
   * host failed the export outright rather than merely running it slowly.
   * Streaming holds nothing bigger than a gzip chunk, and `tar.c` writes no
   * intermediate `.tar.gz` to unlink afterwards either.
   *
   * The temp tree is removed when the stream ends, errors, or is cancelled —
   * the last case being a client that disconnects mid-download. Only the walk
   * is awaited here: `exportDir` is where storage and blob errors surface, so
   * a failing export still reports before a single byte has been written, and
   * a caller that has already sent headers can only truncate on a later
   * gzip-level error.
   */
  static async exportTarGzStream(
    store: Storage,
    opts: ExportOptions,
    blobStorage?: BlobStorage | string
  ): Promise<ReadableStream<Uint8Array>> {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-export-"));
    try {
      await Exporter.exportDir(store, tmpDir, opts, blobStorage);
      const files = await fs.readdir(tmpDir);
      const pack = c({ gzip: true, cwd: tmpDir }, files);
      return Exporter.streamPack(pack, tmpDir);
    } catch (error) {
      // The stream owns the temp tree once it exists; until then this does.
      await fs.rm(tmpDir, { recursive: true, force: true });
      throw error;
    }
  }

  /**
   * `tar.c`'s output as a web stream, cleaning up `tmpDir` when it is done
   * with.
   *
   * The pack is a Minipass, which flows as soon as a `data` listener is
   * attached — so it is paused immediately and only resumed on `pull`, which
   * is what carries the consumer's backpressure back to the tar walk.
   */
  private static streamPack(
    pack: Pack,
    tmpDir: string
  ): ReadableStream<Uint8Array> {
    const cleanup = () => {
      void fs.rm(tmpDir, { recursive: true, force: true });
    };

    return new ReadableStream<Uint8Array>({
      start(controller) {
        pack.on("data", (chunk: Buffer) => {
          controller.enqueue(chunk);
          if ((controller.desiredSize ?? 1) <= 0) pack.pause();
        });
        pack.on("end", () => {
          controller.close();
          cleanup();
        });
        pack.on("error", (error: unknown) => {
          controller.error(error);
          cleanup();
        });
        pack.pause();
      },
      pull() {
        pack.resume();
      },
      cancel() {
        pack.destroy();
        cleanup();
      },
    });
  }

  /**
   * The tarball, to a file path or to a writer.
   *
   * A string path is handed straight to `tar.c`, which writes it itself. Any
   * other writer is fed from `exportTarGzStream`, one chunk at a time — each
   * `write` is awaited, so a slow writer slows the walk rather than piling the
   * archive up in memory. The writer is written to and not closed; whoever
   * opened it owns closing it.
   */
  static async exportTarGz(
    store: Storage,
    w: any,
    opts: ExportOptions,
    blobStorage?: BlobStorage | string
  ): Promise<void> {
    if (typeof w === "string") {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-export-"));
      try {
        await Exporter.exportDir(store, tmpDir, opts, blobStorage);
        await c({ gzip: true, cwd: tmpDir, file: w }, await fs.readdir(tmpDir));
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
      return;
    }

    if (typeof w?.write !== "function") {
      throw new Error("unsupported writer type");
    }

    const reader = (
      await Exporter.exportTarGzStream(store, opts, blobStorage)
    ).getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        await w.write(value);
      }
    } finally {
      // Releasing the lock is not enough on a partial read: cancel is what
      // tears the tar walk down and removes the temp tree.
      await reader.cancel();
    }
  }
}
