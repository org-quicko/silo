import { monotonicFactory } from "ulidx";
import { JsonPath } from "@silo/shared/json-path";
import type { Entry } from "../../domain/entry";
import { EntryUtils } from "../../domain/entry-utils";
import { Scope } from "../../domain/scope";
import { SystemCollections } from "../../domain/system-collections";
import { NotFoundError } from "../../errors/not-found-error";
import type { Query } from "../../query/query";
import type { TrashItem } from "../../trash/trash-item";
import type { TrashReceipt } from "../../trash/trash-receipt";
import type { ServiceContext } from "../support/service-context";

/**
 * Reads and writes the `_trash` and `_trash_items` documents (D91).
 *
 * Both live in `Scope.System`, so every trash service goes through here rather
 * than repeating the scope and collection names — the arrangement
 * `MediaCatalogStore` already uses for the media catalog.
 */
export class TrashStore {
  /** Enough to sweep or replay any one receipt's contents in one pass. */
  static readonly PageSize = 1000;

  /**
   * Monotonic, like the audit trail's: the trash is read newest first and two
   * receipts written in the same millisecond must not sort either way.
   */
  private static readonly nextId = monotonicFactory();

  private readonly context: ServiceContext;

  constructor(context: ServiceContext) {
    this.context = context;
  }

  get scope(): Scope {
    return Scope.System;
  }

  static newId(): string {
    return TrashStore.nextId();
  }

  async putReceipt(id: string, receipt: TrashReceipt, created?: Date): Promise<void> {
    const now = EntryUtils.now();
    let rev = 1;
    let createdAt = created ?? now;
    const existing = await this.findReceipt(id);
    if (existing) {
      rev = existing.rev + 1;
      createdAt =
        existing.created_at instanceof Date ? existing.created_at : new Date(existing.created_at);
    }
    await this.put(SystemCollections.Trash, id, receipt, rev, createdAt, now);
  }

  async findReceipt(id: string): Promise<Entry | null> {
    try {
      return await this.context.store.get(this.scope, SystemCollections.Trash, id);
    } catch (error) {
      if (error instanceof NotFoundError) return null;
      throw error;
    }
  }

  async receipt(id: string): Promise<Entry> {
    EntryUtils.assertSafeSegment(id, "id");
    const found = await this.findReceipt(id);
    if (!found) throw new NotFoundError(`trash item "${id}" not found`);
    return found;
  }

  /** Newest first, sorted by the id for the reason `nextId` is monotonic. */
  async listReceipts(
    page: { limit?: number; offset?: number } = {}
  ): Promise<{ items: Entry[]; total: number }> {
    const query: Query = {
      sort: [{ path: JsonPath.Id, desc: true }],
      limit: page.limit ?? TrashStore.PageSize,
      offset: page.offset ?? 0,
    };
    return this.context.store.list(this.scope, SystemCollections.Trash, query);
  }

  async deleteReceipt(id: string): Promise<void> {
    try {
      await this.context.store.delete(this.scope, SystemCollections.Trash, id);
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
    }
  }

  async putItem(item: TrashItem): Promise<string> {
    const id = EntryUtils.newID();
    const now = EntryUtils.now();
    await this.put(SystemCollections.TrashItems, id, item, 1, now, now);
    return id;
  }

  /** One receipt's parked records, a page at a time. */
  async listItems(
    trashId: string,
    page: { limit?: number; offset?: number } = {}
  ): Promise<{ items: Entry[]; total: number }> {
    return this.context.store.list(this.scope, SystemCollections.TrashItems, {
      filter: { op: "eq", path: "$.data.trash_id", value: trashId },
      limit: page.limit ?? TrashStore.PageSize,
      offset: page.offset ?? 0,
    });
  }

  /** Every parked record for a receipt, dropped one at a time. */
  async deleteItems(trashId: string): Promise<number> {
    let removed = 0;
    while (true) {
      const { items } = await this.listItems(trashId, { limit: TrashStore.PageSize, offset: 0 });
      if (items.length === 0) return removed;
      for (const entry of items) {
        await this.context.store.delete(this.scope, SystemCollections.TrashItems, entry.id);
        removed += 1;
      }
    }
  }

  private async put(
    collection: string,
    id: string,
    data: unknown,
    rev: number,
    createdAt: Date,
    updatedAt: Date
  ): Promise<void> {
    const entry: Entry = {
      id,
      project: this.scope.project,
      env: this.scope.env,
      collection,
      rev,
      seq: 0,
      created_at: createdAt,
      updated_at: updatedAt,
      data,
    };
    // Parked content holds no live media reference and is never searched.
    await this.context.store.put(entry, { usages: [], search: null });
  }
}
