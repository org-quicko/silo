import fs from "fs/promises";
import path from "path";
import os from "os";
import type { Storage } from "../ports/storage";
import type { BlobStorage } from "../ports/blob-storage";
import { FsBlobStorage } from "../../adapters/blob/fs-blob-storage";
import type { Entry } from "../domain/entry";
import { EntryUtils } from "../domain/entry-utils";
import type { Meta } from "../domain/meta";
import type { Scope } from "../domain/scope";
import { ValidationError } from "@silo/shared/validation-error";
import { ArchiveTooLargeError } from "../errors/archive-too-large-error";
import { ConflictError } from "../errors/conflict-error";
import { NotFoundError } from "../errors/not-found-error";
import { MediaRefs } from "../media/media-refs";
import { SearchText } from "../search/search-text";
import { SchemaChangeGuard } from "../schema/schema-change-guard";
import { SchemaValidator } from "../schema/schema-validator";
import { ArchiveExtractor } from "./archive-extractor";
import { FormatVersion } from "./format-version";
import type { ExportManifest } from "./export-manifest";
import { ImportAuthority } from "./import-authority";
import { ImportFilter } from "./import-filter";
import { ImportLimits } from "./import-limits";
import { ImportSystemGate } from "./import-system-gate";
import { ImportWalker, type ScopedImport } from "./import-walker";
import { ImportMedia } from "./import-media";
import type { ParsedImport } from "./parsed-import";
import type { ImportOptions } from "./import-options";
import type { ImportResult } from "./import-result";
import { ScopeCopyPreviewBuilder } from "./scope-copy-preview-builder";

export class Importer {
  /**
   * How many rejected entries an import names individually (D70).
   *
   * `rejected` is always the true count; this bounds only the list beside it.
   * An archive exported under a schema the destination has since tightened can
   * fail on every row, and a result carrying a message per entry would be a
   * response larger than the archive — while the first hundred already say
   * which collections are affected and why.
   */
  static readonly RejectionLimit = 100;

  /** Entries between progress reports. Often enough that a caller watching a
   *  long import never waits a second for a sign of life, rare enough that the
   *  reporting is not itself the work. */
  static readonly ProgressInterval = 200;

  /** How much of a spooled upload may sit in the sink before it is flushed. */
  static readonly SpoolFlushBytes = 8 * 1024 * 1024;

  /** Rows read per page when a replaced collection is pruned (D85). */
  static readonly PrunePage = 500;

  /** How often a staging directory's removal is retried, and how long between
   *  tries: an aborted extraction can still be closing the last file it wrote. */
  static readonly DiscardAttempts = 5;
  static readonly DiscardRetryMs = 100;

  /** The spooled upload's name inside the staging directory. Removed before
   *  the walk, and never mistaken for content: the walk reads `projects/`,
   *  `media/` and `manifest.json` and nothing else. */
  static readonly SpoolName = ".silo-upload.tar.gz";

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
      rejected: 0,
      rejections: [],
    };
    const preview = ScopeCopyPreviewBuilder.from(opts);

    const localMeta = await store.meta();
    // Unconditional since D70. It used to be built only for `opts.validate`,
    // which defaulted to false everywhere it was offered — so the documented
    // guarantee that entries are validated on the way in had a door in it that
    // every archive and every scope copy came through by default.
    const validator = new SchemaValidator(store);

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
      await Importer.executeScopedImport(store, scoped, pi.manifest, localMeta, mode, opts, response, validator, preview);
      opts.onProgress?.({ phase: "entries", result: response });
    }

    if (preview) response.scope_copy = preview.result();

    return response;
  }

  // Replace mode acts only on the collections present in the archive **for
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
    validator: SchemaValidator,
    preview?: ScopeCopyPreviewBuilder,
  ): Promise<void> {
    const { scope, schemas, entries } = scoped;

    if (!scope.isSystem() && !opts.dryRun) {
      await Importer.createRecord(() => store.createProject(scope.project));
      await Importer.createRecord(
        (id) => store.createEnvironment(scope.project, scope.env, id),
        scoped.envId
      );
    }

    // Replace brings each collection the archive is authoritative for to the
    // archive's content, and does it in an order that never empties anything
    // first (D85): every row the archive carries is written over what is
    // there, and every row it does not carry is removed afterwards, in
    // `prune`. It used to delete the collection and then refill it, which
    // meant a failure between the two — a full disk, an OOM kill, a stop —
    // left a collection with nothing in it and nothing coming. Now an
    // interruption leaves rows the archive did not name beside the ones it
    // did, and the next run removes them. The ids written per collection are
    // kept here so `prune` knows what to spare.
    const replacing = new Map<string, Set<string>>();
    if (mode === "replace") {
      // Only what this archive is authoritative for. A partial archive replaces
      // the content collections it names and nothing in `_system`, where its
      // rows are a subset rather than the whole (§7.7).
      const replaceCollections = [...new Set([...schemas.keys(), ...entries.keys()])].filter(
        (colName) => ImportAuthority.replaces(scope, colName, manifest, opts)
      );
      for (const colName of replaceCollections) {
        replacing.set(colName, new Set());
        try {
          // What is there now is what replace does away with, overwritten or
          // removed — which is what `deleted` has always counted.
          const { total } = await store.list(scope, colName, { limit: 1, offset: 0 });
          response.deleted += total;
          if (preview) {
            if (opts.scopeCopyPreview?.includeDestinationDetails && preview.needsIds(total)) {
              const start = Math.max(0, opts.scopeCopyPreview.offset - preview.position());
              const length = Math.min(total - start, opts.scopeCopyPreview.limit);
              const page = await store.list(scope, colName, { sort: [{ path: "$.id", desc: false }], limit: length, offset: start });
              preview.repeated(colName, "deleted", start);
              preview.entriesFor(colName, "deleted", page.items.map((entry) => entry.id));
              preview.repeated(colName, "deleted", total - start - page.items.length);
            } else {
              preview.repeated(colName, "deleted", total);
            }
          }
          // The schema is **not** deleted. It used to be, and re-put a moment
          // later — which under record keying destroys the collection record
          // and mints a new id for the same collection, losing the identity
          // the destination already had. `putSchema` below replaces the
          // schema in place and keeps it (D51).
        } catch (caught: any) {
          if (!(caught instanceof NotFoundError)) {
            throw caught;
          }
        }
      }
    }

    // Import schemas.
    //
    // Only the **merge-over-existing** branch is guarded (D70), because it is
    // the only one that can leave entries filed under constraints that never
    // judged them. Replace brings the collection to the archive's content
    // below — every row overwritten or removed — and a collection that does
    // not exist yet has nothing to invalidate, so guarding either would refuse
    // an import that is safe.
    //
    // The guard runs on a dry run too, and that is the point: for merge, the
    // count it reads is the same one the real run would read, so the dry run
    // predicts the refusal instead of the operator meeting it at apply time.
    // Replace is exempt for the same reason in reverse — a dry run removes
    // nothing, so a guard there would report a conflict the real run resolves.
    for (const [colName, remoteSchema] of schemas.entries()) {
      const write = async (guarded: boolean) => {
        if (guarded) await SchemaChangeGuard.assert(store, scope, colName, remoteSchema);
        if (opts.dryRun) return;
        await Importer.createRecord(
          (id) => store.putSchema(scope, colName, remoteSchema, id),
          scoped.collectionIds.get(colName)
        );
      };

      try {
        const localSchema = await store.getSchema(scope, colName);
        if (mode === "merge") {
          if (JSON.stringify(localSchema) !== JSON.stringify(remoteSchema)) {
            preview?.schema(colName, opts.prefer === "local" ? "unchanged" : "update");
            if (opts.prefer === "local") {
              continue;
            }
            await write(true);
          }
          else preview?.schema(colName, "unchanged");
        } else {
          preview?.schema(colName, "update");
          await write(false);
        }
      } catch (caught: any) {
        if (caught instanceof NotFoundError) {
          preview?.schema(colName, "create");
          await write(false);
        } else {
          throw caught;
        }
      }
    }

    validator.invalidate();

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

      /**
       * Writes one entry, or records why the schema refused it (D70).
       *
       * Answers false when the entry was rejected, so the caller counts it as
       * neither an add nor an update — the counts stay a description of what
       * reached the destination, and `rejected` describes the rest. A rejected
       * row is also left out of what a replace spares, so a row the archive
       * carries but the schema refuses is removed rather than kept as it was.
       *
       * A dry run never reaches the validator. The schemas it would have
       * written are still unwritten, so judging entries against the local ones
       * would invent failures a real import would not have and miss the ones it
       * would; a confident wrong answer is worse than no answer.
       */
      const write = async (remote: Entry): Promise<boolean> => {
        if (opts.dryRun) return true;
        if (colValidator) {
          try {
            await colValidator.validateEntry(scope, colName, remote.data);
          } catch (caught: any) {
            if (!ValidationError.is(caught)) throw caught;
            response.rejected++;
            if (response.rejections.length < Importer.RejectionLimit) {
              response.rejections.push({
                project: scope.project,
                env: scope.env,
                collection: colName,
                id: remote.id,
                reason: caught.message,
              });
            }
            return false;
          }
        }
        await store.put(remote, derived(remote.data));
        replacing.get(colName)?.add(remote.id);
        return true;
      };

      let sinceReport = 0;
      for await (const remote of remoteEntries) {
        if (++sinceReport >= Importer.ProgressInterval) {
          sinceReport = 0;
          opts.onProgress?.({ phase: "entries", result: response });
        }
        if (mode === "replace") {
          if (!(await write(remote))) continue;
          response.added++;
          preview?.entriesFor(colName, "added", [remote.id]);
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
            if (!(await write(remote))) continue;
            response.updated++;
            preview?.entriesFor(colName, "updated", [remote.id]);
          } else {
            response.skipped++;
            preview?.entriesFor(colName, "skipped", [remote.id]);
          }
        } catch (caught: any) {
          if (caught instanceof NotFoundError) {
            if (!(await write(remote))) continue;
            response.added++;
            preview?.entriesFor(colName, "added", [remote.id]);
          } else {
            throw caught;
          }
        }
      }
    }

    if (mode === "replace" && !opts.dryRun) {
      for (const [colName, kept] of replacing) {
        await Importer.prune(store, scope, colName, kept);
      }
    }
  }

  /**
   * Removes every row of a replaced collection the archive did not carry (D85).
   *
   * Runs after the archive's rows are written, so the collection is never empty
   * between the two. Ids are collected before anything is deleted, because
   * deleting while paging by offset skips rows; the set of ids is small where
   * the rows are not.
   */
  private static async prune(
    store: Storage,
    scope: Scope,
    collection: string,
    kept: ReadonlySet<string>
  ): Promise<void> {
    const stale: string[] = [];
    try {
      for (let offset = 0; ; ) {
        const { items } = await store.list(scope, collection, {
          sort: [{ path: "$.id", desc: false }],
          limit: Importer.PrunePage,
          offset,
        });
        if (items.length === 0) break;
        for (const entry of items) {
          if (!kept.has(entry.id)) stale.push(entry.id);
        }
        offset += items.length;
      }
    } catch (caught) {
      if (caught instanceof NotFoundError) return;
      throw caught;
    }
    for (const id of stale) {
      await store.delete(scope, collection, id);
    }
  }

  static async importDir(
    store: Storage,
    src: string,
    opts: ImportOptions,
    blobStorage?: BlobStorage | string
  ): Promise<ImportResult> {
    // Narrowed before the gate, so a selection that leaves `_keys` behind is
    // judged on what it actually loads (D84).
    const pi = ImportFilter.apply(await Importer.parseImportDir(src), opts.include);
    await ImportSystemGate.assert(pi, opts);
    const response = await Importer.executeImport(store, pi, opts);

    if (blobStorage) {
      opts.onProgress?.({ phase: "media", result: response });
      response.media = {
        files: await ImportMedia.load({
          source: src,
          blobStorage:
            typeof blobStorage === "string" ? new FsBlobStorage(blobStorage) : blobStorage,
          manifest: pi.manifest,
          options: opts,
        }),
        cleared: ImportAuthority.clearsLibrary(pi.manifest, opts),
      };
    }

    return response;
  }

  /**
   * Unpack a streamed archive — an upload body, or another instance's export —
   * into a fresh staging directory, and answer its path.
   *
   * Separate from the load on purpose (D85): the caller takes the write lock
   * around `importDir` alone, so a slow upload holds up nothing but itself,
   * where the old shape held the lock from the first byte. The caller owns the
   * directory from here and removes it with {@link discard}; on a failure here
   * it is already gone.
   */
  static async stage(archive: ReadableStream<Uint8Array>, opts: ImportOptions): Promise<string> {
    const tmpDir = await Importer.staging(opts, "silo-import-");
    try {
      opts.onProgress?.({ phase: "extract", result: Importer.emptyResult(opts) });
      await Importer.extractStream(archive, tmpDir, opts.limits);
      return tmpDir;
    } catch (caught) {
      await Importer.discard(tmpDir);
      throw caught;
    }
  }

  /** A tarball already on disk, unpacked the same way. */
  static async stageFile(tarballPath: string, opts: ImportOptions): Promise<string> {
    const tmpDir = await Importer.staging(opts, "silo-import-");
    try {
      await ArchiveExtractor.extract(tarballPath, tmpDir, opts.limits);
      return tmpDir;
    } catch (caught) {
      await Importer.discard(tmpDir);
      throw caught;
    }
  }

  /** Removes a staging directory, retrying briefly: an aborted extraction can
   *  still be closing the last file it wrote. */
  static async discard(directory: string): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      try {
        await fs.rm(directory, { recursive: true, force: true });
        return;
      } catch (caught) {
        if (attempt >= Importer.DiscardAttempts) throw caught;
        await Bun.sleep(Importer.DiscardRetryMs);
      }
    }
  }

  /**
   * Load an archive that arrives as a stream, staging and loading in one call.
   *
   * The service takes the two halves separately so the write lock covers only
   * the second; this is the shape for a caller with no lock to hold.
   */
  static async importTarGzStream(
    store: Storage,
    archive: ReadableStream<Uint8Array>,
    opts: ImportOptions,
    blobStorage?: BlobStorage | string
  ): Promise<ImportResult> {
    const staged = await Importer.stage(archive, opts);
    try {
      return await Importer.importDir(store, staged, opts, blobStorage);
    } finally {
      await Importer.discard(staged);
    }
  }

  /**
   * The upload spooled to one file, with backpressure the tar parser does not
   * give, and held to the archive ceiling as it arrives (D85).
   *
   * `Unpack.write` answers `false` only for its own small buffer and keeps
   * accepting entries while it writes them out, so feeding it a stream as fast
   * as the stream arrives held the whole archive: a 750 MB copy peaked at
   * 2.0 GB of private memory on the destination, measured, with the same number
   * on a dry run that writes nothing. Spooling costs the archive's size in
   * **disk**, which a small host has and which the extracted tree was going to
   * need beside it anyway, and holds one flush budget in memory.
   */
  private static async spool(
    archive: ReadableStream<Uint8Array>,
    destination: string,
    limits?: ImportLimits
  ): Promise<void> {
    const file = Bun.file(destination).writer();
    const reader = archive.getReader();
    let pending = 0;
    let received = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (limits && received > limits.maxArchiveBytes) {
          throw new ArchiveTooLargeError(
            `archive is larger than ${ImportLimits.megabytes(limits.maxArchiveBytes)} MB; ` +
              `raise [transfer] max_archive_size_mb to load it`
          );
        }
        await file.write(value);
        pending += value.byteLength;
        if (pending >= Importer.SpoolFlushBytes) {
          await file.flush();
          pending = 0;
        }
      }
      await file.flush();
    } finally {
      await reader.cancel().catch(() => {});
      file.end();
    }
  }

  /**
   * A directory to unpack into.
   *
   * `stagingDirectory` is honoured when the caller named one, because the
   * platform temp directory is often not the disk the operator thinks it is —
   * a unit with `PrivateTmp` puts it on a RAM-backed tmpfs, where extracting
   * an archive costs memory rather than the disk the data already sits on.
   */
  private static async staging(opts: ImportOptions, prefix: string): Promise<string> {
    const root = opts.stagingDirectory;
    if (!root) return fs.mkdtemp(path.join(os.tmpdir(), prefix));
    await fs.mkdir(root, { recursive: true });
    return fs.mkdtemp(path.join(root, prefix));
  }

  /** A zeroed result, so the first progress line has the same shape as the
   *  rest before any counting has happened. */
  private static emptyResult(opts: ImportOptions): ImportResult {
    return {
      mode: opts.mode || "merge",
      dry_run: !!opts.dryRun,
      added: 0,
      updated: 0,
      deleted: 0,
      skipped: 0,
      rejected: 0,
      rejections: [],
    };
  }

  /**
   * Spool the upload, then extract it from disk.
   *
   * Feeding `tar.x` the stream directly is what the shape of the code invites
   * and it does not hold: `Unpack` keeps accepting entries while it writes them
   * out, so the parser absorbed the archive as fast as it arrived. Reading from
   * a file instead lets tar pull at its own pace, which is the backpressure the
   * writable form never offered.
   *
   * The spool is removed before the walk, so the archive and the tree it
   * expands to are not both on disk while the entries are loaded.
   */
  private static async extractStream(
    archive: ReadableStream<Uint8Array>,
    dest: string,
    limits?: ImportLimits
  ): Promise<void> {
    const spooled = path.join(dest, Importer.SpoolName);
    try {
      await Importer.spool(archive, spooled, limits);
      await ArchiveExtractor.extract(spooled, dest, limits);
    } finally {
      await fs.rm(spooled, { force: true });
    }
  }

  /**
   * Load an archive from a path, or from a `Buffer` a caller already holds.
   *
   * A path is unpacked by `stageFile`. A `Buffer` is already whole in memory,
   * so there is nothing left to stream — it goes through the same extraction
   * as one chunk.
   */
  static async importTarGz(
    store: Storage,
    tarballPathOrBuffer: string | Buffer,
    opts: ImportOptions,
    blobStorage?: BlobStorage | string
  ): Promise<ImportResult> {
    if (typeof tarballPathOrBuffer !== "string") {
      return Importer.importTarGzStream(store, Importer.streamOf(tarballPathOrBuffer), opts, blobStorage);
    }

    const staged = await Importer.stageFile(tarballPathOrBuffer, opts);
    try {
      return await Importer.importDir(store, staged, opts, blobStorage);
    } finally {
      await Importer.discard(staged);
    }
  }

  /** A buffer as the one-chunk stream the staged path reads. */
  static streamOf(buffer: Buffer): ReadableStream<Uint8Array> {
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(buffer);
        controller.close();
      },
    });
  }
}
