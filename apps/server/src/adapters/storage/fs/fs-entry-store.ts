import fs from "fs/promises";
import path from "path";
import type { Entry } from "../../../core/domain/entry";
import { EntryUtils } from "../../../core/domain/entry-utils";
import type { Scope } from "../../../core/domain/scope";
import { NotFoundError } from "../../../core/errors/not-found-error";
import { EntryNodes } from "../../../core/query/entry-nodes";
import type { Query } from "../../../core/query/query";
import { FsFilter } from "./fs-filter";
import { FsFiles } from "./fs-files";
import { FsLayout } from "./fs-layout";
import type { FsManifestStore } from "./fs-manifest-store";

/**
 * Entries as one JSON file each, under `content/<collection>/<id>.json`.
 *
 * `collection` and `id` (and `project`/`env` on write) are validated as safe
 * path segments — a `Storage` port contract both adapters enforce, and this
 * adapter's actual traversal defense: without it, an import archive whose entry
 * id is `"../../../../elsewhere/prod/content/posts/PLANTED"` would resolve
 * straight through `path.join` into another scope, or out of the data dir.
 */
export class FsEntryStore {
  /** Matches the default page size the Query AST normalises to. */
  private static readonly FallbackLimit = 50;

  private readonly layout: FsLayout;
  private readonly manifest: FsManifestStore;

  constructor(layout: FsLayout, manifest: FsManifestStore) {
    this.layout = layout;
    this.manifest = manifest;
  }

  /**
   * The adapter keeps no derived index of either kind, which is why `put` takes
   * none. Usages are derived by scanning entry files at query time (D23) and
   * search is the same bargain (D30): an on-disk index would break the frozen
   * layout (D5), and an in-memory one would go stale under an `rsync` or a
   * `git checkout` beneath a running process — precisely the staleness this
   * adapter exists not to have.
   */
  async put(entry: Entry): Promise<void> {
    EntryUtils.assertSafeSegment(entry.project, "project");
    EntryUtils.assertSafeSegment(entry.env, "env");
    EntryUtils.assertSafeSegment(entry.collection, "collection");
    EntryUtils.assertSafeSegment(entry.id, "id");

    // The collection has to exist as a record. Its schema is `NOT NULL`, so
    // nothing here could create one, and an entry in a collection with no
    // schema is the state that invariant exists to rule out (D51). The scope
    // itself is still created implicitly, by `putSchema`.
    const marker = this.layout.collectionMarkerFileIn(
      entry.project,
      entry.env,
      entry.collection
    );
    if (!(await FsFiles.exists(marker))) {
      throw new NotFoundError(
        `collection "${entry.project}/${entry.env}/${entry.collection}" not found`
      );
    }

    entry.seq = await this.manifest.nextSeq();

    const document = {
      id: entry.id,
      project: entry.project,
      env: entry.env,
      collection: entry.collection,
      rev: entry.rev,
      seq: entry.seq,
      created_at: FsEntryStore.isoDate(entry.created_at),
      updated_at: FsEntryStore.isoDate(entry.updated_at),
      data: entry.data,
    };

    const filePath = path.join(
      this.layout.envDir(entry.project, entry.env),
      "content",
      entry.collection,
      `${entry.id}${FsLayout.EntrySuffix}`
    );
    await FsFiles.writeAtomic(filePath, JSON.stringify(document, null, 2));
  }

  async get(scope: Scope, collection: string, id: string): Promise<Entry> {
    EntryUtils.assertSafeSegment(collection, "collection");
    EntryUtils.assertSafeSegment(id, "id");

    try {
      const raw = await fs.readFile(this.layout.entryFile(scope, collection, id), "utf8");
      return FsEntryStore.toEntry(scope, collection, id, JSON.parse(raw));
    } catch (error: any) {
      if (error.code === "ENOENT") throw FsEntryStore.notFound(scope, collection, id);
      throw error;
    }
  }

  async delete(scope: Scope, collection: string, id: string): Promise<void> {
    EntryUtils.assertSafeSegment(collection, "collection");
    EntryUtils.assertSafeSegment(id, "id");

    try {
      await fs.unlink(this.layout.entryFile(scope, collection, id));
    } catch (error: any) {
      if (error.code === "ENOENT") throw FsEntryStore.notFound(scope, collection, id);
      throw error;
    }
  }

  /** Reads the whole collection, then filters, sorts and pages in memory —
   *  the O(n)-per-query character §6.3 commits this adapter to. */
  async list(
    scope: Scope,
    collection: string,
    query: Query
  ): Promise<{ items: Entry[]; total: number }> {
    EntryUtils.assertSafeSegment(collection, "collection");

    const matched = (await this.readCollection(scope, collection)).filter(
      (entry) => !query.filter || FsFilter.evaluateFilter(entry, query.filter)
    );
    FsEntryStore.sort(matched, query);

    const total = matched.length;
    const limit = query.limit > 0 ? query.limit : FsEntryStore.FallbackLimit;
    const offset = Math.max(query.offset, 0);
    if (offset >= total) return { items: [], total };

    return { items: matched.slice(offset, Math.min(offset + limit, total)), total };
  }

  /** Collections in `scope` that still hold at least one entry. A directory
   *  left behind by deleting the last entry is not a collection. */
  async listCollections(scope: Scope): Promise<string[]> {
    const contentDir = this.layout.contentDir(scope);
    const names: string[] = [];

    for (const dirent of await FsFiles.readDirents(contentDir)) {
      if (!dirent.isDirectory()) continue;

      const files = await FsFiles.readNames(path.join(contentDir, dirent.name));
      if (files.some((file) => FsLayout.idOfEntryFile(file) !== null)) {
        names.push(dirent.name);
      }
    }
    return names.sort();
  }

  private async readCollection(scope: Scope, collection: string): Promise<Entry[]> {
    const collectionDir = this.layout.collectionDir(scope, collection);
    const entries: Entry[] = [];

    for (const file of await FsFiles.readNames(collectionDir)) {
      const id = FsLayout.idOfEntryFile(file);
      if (id === null) continue;

      const raw = await fs.readFile(path.join(collectionDir, file), "utf8");
      entries.push(FsEntryStore.toEntry(scope, collection, id, JSON.parse(raw)));
    }
    return entries;
  }

  /** Ties break on id, so paging is stable across calls. */
  private static sort(entries: Entry[], query: Query): void {
    entries.sort((left, right) => {
      for (const key of query.sort ?? []) {
        const comparison = EntryNodes.compare(
          EntryNodes.sortValue(left, key.path),
          EntryNodes.sortValue(right, key.path)
        );
        if (comparison !== 0) return key.desc ? -comparison : comparison;
      }
      return left.id.localeCompare(right.id);
    });
  }

  /**
   * `project`/`env`/`collection`/`id` come from the path that located the file,
   * never from the file's own contents: the path is the addressing authority
   * (D18, the same rule `ImportWalker` applies to archives).
   *
   * Trusting an envelope that disagrees with its path would let `get` return an
   * entry the service then writes back under the wrong scope, forking it. A
   * forged `id` is the same bug one field over: it made an entry `list`
   * returned but `get` and `delete` could not find, leaving the collection
   * undeletable.
   */
  private static toEntry(scope: Scope, collection: string, id: string, parsed: any): Entry {
    return {
      id,
      project: scope.project,
      env: scope.env,
      collection,
      rev: Number(parsed.rev),
      seq: Number(parsed.seq),
      created_at: new Date(parsed.created_at),
      updated_at: new Date(parsed.updated_at),
      data: parsed.data,
    };
  }

  private static isoDate(value: Date | string): string {
    return value instanceof Date ? value.toISOString() : value;
  }

  private static notFound(scope: Scope, collection: string, id: string): NotFoundError {
    return new NotFoundError(`entry ${scope.key()}/${collection}/${id} not found`);
  }
}
