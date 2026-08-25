import type { Entry } from "../../domain/entry";
import { EntryUtils } from "../../domain/entry-utils";
import { Scope } from "../../domain/scope";
import { NotFoundError } from "../../errors/not-found-error";
import { MediaCatalog } from "../../media/media-catalog";
import type { MediaAsset } from "../../media/media-asset";
import type { MediaFolder } from "../../media/media-folder";
import type { Query } from "../../query/query";
import type { ServiceContext } from "../support/service-context";

/**
 * Reads and writes the `_media` and `_media_folders` documents.
 *
 * The catalog is the source of truth for everything *about* a file;
 * `BlobStorage` holds only bytes. Both collections live in `Scope.System`, so
 * every media service goes through here rather than repeating the scope and
 * collection names at each call (D23).
 */
export class MediaCatalogStore {
  /** Enough to page an entire catalog in one call; media libraries are small
   *  relative to entry collections and every caller here wants all of it. */
  static readonly WholeCatalog = 100_000;

  private readonly context: ServiceContext;

  constructor(context: ServiceContext) {
    this.context = context;
  }

  /** Media is instance-global: one library for the whole server (D23). */
  get scope(): Scope {
    return Scope.System;
  }

  /** The `_media` document for an asset, or a `NotFoundError` naming it. */
  async asset(id: string): Promise<Entry> {
    EntryUtils.assertSafeSegment(id, "id");
    try {
      return await this.context.store.get(this.scope, MediaCatalog.Collection, id);
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw new NotFoundError(`media asset "${id}" not found`);
      }
      throw error;
    }
  }

  /** The `_media` document for an asset, or null. Unlike {@link asset} it does
   *  not judge the id — callers that fall through to another lookup want a
   *  miss, not a rejection. */
  async findAsset(id: string): Promise<Entry | null> {
    try {
      return await this.context.store.get(this.scope, MediaCatalog.Collection, id);
    } catch (error) {
      if (error instanceof NotFoundError) return null;
      throw error;
    }
  }

  /** Creates or replaces an asset's document, carrying `created_at` forward. */
  async putAsset(id: string, asset: MediaAsset, created?: Date): Promise<Entry> {
    const now = EntryUtils.now();
    let rev = 1;
    let createdAt = created || now;

    try {
      const current = await this.context.store.get(this.scope, MediaCatalog.Collection, id);
      rev = current.rev + 1;
      createdAt =
        current.created_at instanceof Date ? current.created_at : new Date(current.created_at);
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
    }

    const entry: Entry = {
      id,
      project: this.scope.project,
      env: this.scope.env,
      collection: MediaCatalog.Collection,
      rev,
      seq: 0,
      created_at: createdAt,
      updated_at: now,
      data: asset,
    };
    // A catalog record holds no media reference of its own.
    await this.context.store.put(entry, { usages: [], search: null });
    return entry;
  }

  async deleteAsset(id: string): Promise<void> {
    await this.context.store.delete(this.scope, MediaCatalog.Collection, id);
  }

  async listAssets(query: Query): Promise<{ items: Entry[]; total: number }> {
    return this.context.store.list(this.scope, MediaCatalog.Collection, query);
  }

  /** Every asset document, unpaged. */
  async allAssets(): Promise<Entry[]> {
    const { items } = await this.listAssets({
      limit: MediaCatalogStore.WholeCatalog,
      offset: 0,
    });
    return items;
  }

  /** The explicit `_media_folders` record for a path, or null. */
  async folder(path: string): Promise<Entry | null> {
    const { items } = await this.context.store.list(this.scope, MediaCatalog.FoldersCollection, {
      filter: { op: "eq", path: "$.data.path", value: path },
      limit: 1,
      offset: 0,
    });
    return items[0] || null;
  }

  /** Every explicit folder record, unpaged. */
  async allFolders(): Promise<Entry[]> {
    const { items } = await this.context.store.list(this.scope, MediaCatalog.FoldersCollection, {
      limit: MediaCatalogStore.WholeCatalog,
      offset: 0,
    });
    return items;
  }

  async putFolder(path: string): Promise<void> {
    const now = EntryUtils.now();
    const entry: Entry = {
      id: EntryUtils.newID(),
      project: this.scope.project,
      env: this.scope.env,
      collection: MediaCatalog.FoldersCollection,
      rev: 1,
      seq: 0,
      created_at: now,
      updated_at: now,
      data: { path } satisfies MediaFolder,
    };
    await this.context.store.put(entry, { usages: [], search: null });
  }

  async deleteFolder(entryId: string): Promise<void> {
    await this.context.store.delete(this.scope, MediaCatalog.FoldersCollection, entryId);
  }
}
