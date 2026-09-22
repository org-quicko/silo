import type { TrashConfig } from "../../../config/trash-config";
import { TrashDefaults } from "../../../config/trash-defaults";
import type { Entry } from "../../domain/entry";
import { EntryUtils } from "../../domain/entry-utils";
import type { Scope } from "../../domain/scope";
import { ConflictError } from "../../errors/conflict-error";
import type { TrashReceipt } from "../../trash/trash-receipt";
import type { TrashView } from "../../trash/trash-view";
import type { ServiceContext } from "../support/service-context";
import { TrashBlockers } from "./trash-blockers";
import { TrashCapture } from "./trash-capture";
import { TrashParker } from "./trash-parker";
import { TrashPurger } from "./trash-purger";
import type { TrashQuery } from "./trash-query";
import type { TrashRestoreResult } from "./trash-restore-result";
import { TrashRestorer } from "./trash-restorer";
import { TrashStore } from "./trash-store";
import { TrashSweeper } from "./trash-sweeper";

/**
 * The trash (D91): what a delete leaves behind, and the two ways out of it.
 *
 * A facade over collaborators, like `MediaService`. `capture` is what the
 * delete paths call; everything else is the trash's own surface. See
 * `docs/design/trash.md`.
 */
export class TrashService {
  private readonly context: ServiceContext;
  private readonly store: TrashStore;
  private readonly purger: TrashPurger;
  private readonly restorer: TrashRestorer;
  private readonly sweeper: TrashSweeper;

  /** What the delete paths call before they erase anything. */
  readonly capture: TrashCapture;

  private config: TrashConfig = {
    enabled: TrashDefaults.Enabled,
    retention_days: TrashDefaults.RetentionDays,
  };

  constructor(context: ServiceContext) {
    this.context = context;
    this.store = new TrashStore(context);
    const parker = new TrashParker(context, this.store);
    this.capture = new TrashCapture(context, parker);
    this.purger = new TrashPurger(context, this.store);
    this.restorer = new TrashRestorer(context, this.store);
    this.sweeper = new TrashSweeper(context, this.store, this.purger);
  }

  /** Set once at construction from `[trash]`, so a change to the file takes
   *  effect at the next start — which is what `ConfigSections` declares. */
  get enabled(): boolean {
    return this.config.enabled;
  }

  /** Zero means "keep until purged by hand", which the admin words
   *  differently from a countdown. */
  get retentionDays(): number {
    return this.config.retention_days;
  }

  useConfig(config: TrashConfig): void {
    this.config = config;
  }

  /**
   * When a thing trashed now would be swept, or null when retention is off.
   * Stamped per receipt rather than compared against a live `retention_days`,
   * so shortening the setting never retroactively destroys content.
   */
  expiryStamp(): string | null {
    if (this.config.retention_days <= 0) return null;
    const at = EntryUtils.now().getTime() + this.config.retention_days * 86_400_000;
    return new Date(at).toISOString();
  }

  async list(query: TrashQuery = {}): Promise<{
    items: TrashView[];
    total: number;
    limit: number;
    offset: number;
  }> {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), TrashStore.PageSize);
    const offset = Math.max(query.offset ?? 0, 0);
    if (!this.config.enabled) return { items: [], total: 0, limit, offset };

    // Filtered in memory rather than pushed into the query: a receipt's
    // narrowing fields are six optional ones across two shapes, and the trash
    // is bounded by retention, not by traffic.
    const { items } = await this.store.listReceipts({
      limit: TrashStore.PageSize,
      offset: 0,
    });
    const matched = items.filter((entry) =>
      TrashService.matches(entry.data as TrashReceipt, query)
    );

    const blockers = new TrashBlockers(this.context.store, items);
    const page = matched.slice(offset, offset + limit);
    const views: TrashView[] = [];
    for (const entry of page) views.push(await this.toView(entry, blockers));
    return { items: views, total: matched.length, limit, offset };
  }

  async get(id: string): Promise<TrashView> {
    const entry = await this.store.receipt(id);
    const { items } = await this.store.listReceipts({ limit: TrashStore.PageSize, offset: 0 });
    return this.toView(entry, new TrashBlockers(this.context.store, items));
  }

  /** The records a receipt parked, read-only, for the admin's expanded row. */
  async items(
    id: string,
    page: { limit?: number; offset?: number } = {}
  ): Promise<{ items: unknown[]; total: number }> {
    await this.store.receipt(id);
    const found = await this.store.listItems(id, page);
    return { items: found.items.map((entry) => entry.data), total: found.total };
  }

  /**
   * Puts a receipt's content back.
   *
   * `chain` restores the blocking ancestors first, which is the admin's
   * "Restore both". `rename` applies to the subject only, for the collision a
   * freed name lets someone else take.
   */
  async restore(
    id: string,
    options: { rename?: string; chain?: boolean } = {}
  ): Promise<TrashRestoreResult> {
    const result: TrashRestoreResult = {
      restored: [],
      projects: 0,
      environments: 0,
      collections: 0,
      entries: 0,
      assets: 0,
      broken_media_refs: [],
    };

    for (const each of await this.chainFor(id, options.chain === true)) {
      await this.replay(each, each === id ? options.rename : undefined, result);
      result.restored.push(each);
    }
    return result;
  }

  async purge(id: string): Promise<void> {
    await this.store.receipt(id);
    await this.context.withWriteLock(() => this.purger.purge(id));
  }

  /** Empties the trash. Root only, and the route asks for a typed confirmation
   *  on top. */
  async empty(): Promise<{ purged: number }> {
    let purged = 0;
    while (true) {
      const { items } = await this.store.listReceipts({
        limit: TrashStore.PageSize,
        offset: 0,
      });
      if (items.length === 0) return { purged };
      for (const entry of items) {
        await this.context.withWriteLock(() => this.purger.purge(entry.id));
        purged += 1;
      }
    }
  }

  sweep(): Promise<{ purged: number; failed: number }> {
    if (!this.config.enabled) return Promise.resolve({ purged: 0, failed: 0 });
    return this.sweeper.sweep();
  }

  resumePending(): Promise<{ finished: number; failed: number }> {
    return this.sweeper.resumePending();
  }

  private async replay(
    id: string,
    rename: string | undefined,
    into: TrashRestoreResult
  ): Promise<void> {
    const entry = await this.store.receipt(id);
    const receipt = entry.data as TrashReceipt;
    if (receipt.state !== "parked") {
      throw new ConflictError(`trash item "${id}" is ${receipt.state}; try again shortly`);
    }

    await this.context.withWriteLock(async () => {
      await this.store.putReceipt(id, { ...receipt, state: "restoring" }, entry.created_at as Date);
      try {
        await this.restorer.replay(id, receipt.subject_id, rename, into);
      } catch (error) {
        await this.store.putReceipt(id, { ...receipt, state: "parked" }, entry.created_at as Date);
        throw error;
      }
      await this.store.deleteItems(id);
      await this.store.deleteReceipt(id);
    });
  }

  /** The receipt ids to replay, ancestors first. One id unless `chain`. */
  private async chainFor(id: string, chain: boolean): Promise<string[]> {
    const order: string[] = [];
    let current: string | null = id;
    const seen = new Set<string>();

    while (current && !seen.has(current)) {
      seen.add(current);
      order.unshift(current);
      const view: TrashView = await this.get(current);
      if (!view.blocked_by) break;
      if (!chain || !view.blocked_by.trash_id) {
        throw new ConflictError(
          `cannot restore "${view.subject_name}": its ${view.blocked_by.kind} "${view.blocked_by.name}" ` +
            (view.blocked_by.trash_id
              ? "is in the trash; restore it first or pass chain"
              : "no longer exists")
        );
      }
      current = view.blocked_by.trash_id;
    }
    return order;
  }

  private async toView(entry: Entry, blockers: TrashBlockers): Promise<TrashView> {
    const receipt = entry.data as TrashReceipt;
    const blocker = await blockers.blockerFor(receipt);
    return {
      ...receipt,
      id: entry.id,
      restorable: !blocker && receipt.state === "parked",
      ...(blocker ? { blocked_by: blocker } : {}),
    };
  }

  private static matches(receipt: TrashReceipt, query: TrashQuery): boolean {
    if (query.kind && receipt.kind !== query.kind) return false;
    if (query.project && receipt.origin.project_name !== query.project) return false;
    if (query.env && receipt.origin.env_name !== query.env) return false;
    if (query.collection && receipt.origin.collection_name !== query.collection) return false;
    if (query.deleted_after && receipt.deleted_at < query.deleted_after) return false;
    if (query.deleted_before && receipt.deleted_at > query.deleted_before) return false;
    if (query.q && !receipt.subject_name.toLowerCase().includes(query.q.toLowerCase())) {
      return false;
    }
    return true;
  }
}
