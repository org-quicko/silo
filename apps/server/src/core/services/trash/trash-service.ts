import type { TrashConfig } from "../../../config/trash-config";
import { TrashDefaults } from "../../../config/trash-defaults";
import type { Entry } from "../../domain/entry";
import { EntryUtils } from "../../domain/entry-utils";
import type { Scope } from "../../domain/scope";
import { ConflictError } from "../../errors/conflict-error";
import type { TrashReceipt } from "../../trash/trash-receipt";
import type { TrashItem } from "../../trash/trash-item";
import type { TrashView } from "../../trash/trash-view";
import type { ServiceContext } from "../support/service-context";
import { TrashBlockers } from "./trash-blockers";
import { TrashCapture } from "./trash-capture";
import { TrashLocator } from "./trash-locator";
import { TrashParker } from "./trash-parker";
import { TrashPurger } from "./trash-purger";
import type { TrashQuery } from "./trash-query";
import type { TrashRestoreResult } from "./trash-restore-result";
import { TrashRestorer } from "./trash-restorer";
import { TrashStore } from "./trash-store";
import { TrashSweeper } from "./trash-sweeper";

/**
 * The trash (D113): what a delete leaves behind, and the two ways out of it.
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

  /**
   * One page of the receipts `query` matches and `visible` admits. Both
   * narrow before the page is cut, so `total` counts only what the caller may
   * see and an early page never hides what a later one holds.
   */
  async list(
    query: TrashQuery = {},
    visible: (receipt: TrashReceipt) => boolean = () => true
  ): Promise<{
    items: TrashView[];
    total: number;
    limit: number;
    offset: number;
  }> {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), TrashStore.PageSize);
    const offset = Math.max(query.offset ?? 0, 0);
    if (!this.config.enabled) return { items: [], total: 0, limit, offset };

    // Filtered in memory rather than pushed into the query: a receipt's
    // narrowing fields are six optional ones across two shapes, the names are
    // today's rather than stored ones, and the trash is bounded by retention,
    // not by traffic.
    const receipts = await this.store.allReceipts();
    const locator = new TrashLocator(this.context.store);
    const matched: Array<{ id: string; receipt: TrashReceipt }> = [];
    for (const entry of receipts) {
      const receipt = await TrashService.withCurrentNames(entry, locator);
      if (TrashService.matches(receipt, query) && visible(receipt)) matched.push({ id: entry.id, receipt });
    }

    const blockers = new TrashBlockers(locator, TrashBlockers.bySubject(receipts));
    const page = matched.slice(offset, offset + limit);
    const views: TrashView[] = [];
    for (const { id, receipt } of page) views.push(await this.toView(id, receipt, blockers));
    return { items: views, total: matched.length, limit, offset };
  }

  async get(id: string): Promise<TrashView> {
    const entry = await this.store.receipt(id);
    const locator = new TrashLocator(this.context.store);
    const receipt = await TrashService.withCurrentNames(entry, locator);
    return this.toView(entry.id, receipt, new TrashBlockers(locator, (subject) => this.store.receiptFor(subject)));
  }

  /** The records a receipt parked, read-only, for the admin's expanded row. */
  async items(
    id: string,
    page: { limit?: number; offset?: number } = {}
  ): Promise<{ items: unknown[]; total: number }> {
    await this.store.receipt(id);
    const found = await this.store.listItems(id, page);
    return {
      items: found.items.map((entry) => {
        const { restore_started: _started, restore_name: _name, ...item } = entry.data as TrashItem;
        return item;
      }),
      total: found.total,
    };
  }

  /**
   * Puts a receipt's content back.
   *
   * `chain` restores the blocking ancestors first, which is the admin's
   * "Restore both". `rename` applies to the subject only, for the collision a
   * freed name lets someone else take. `authorize` sees every receipt the
   * restore will replay, ancestors included, before the first is written.
   */
  async restore(
    id: string,
    options: {
      rename?: string;
      chain?: boolean;
      authorize?: (view: TrashView, rename: string | undefined) => void;
    } = {}
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

    const subject = await this.get(id);
    const rename = await this.store.restoreRename(id, subject.subject_id, subject.subject_name, options.rename);
    options.authorize?.(subject, rename);
    const chain = await this.chainFor(subject, options.chain === true);
    const renames = new Map<string, string | undefined>([[id, rename]]);
    for (const view of chain) {
      if (view.id === id) continue;
      const ancestorRename = await this.store.restoreRename(view.id, view.subject_id, view.subject_name);
      renames.set(view.id, ancestorRename);
      options.authorize?.(view, ancestorRename);
    }
    for (const view of chain) {
      await this.replay(view.id, renames.get(view.id), result);
      result.restored.push(view.id);
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

  /** Blob keys the parked assets hold, so `silo media reconcile` neither
   *  reports nor adopts them. Read whether or not the trash is on. */
  parkedBlobKeys(): Promise<Set<string>> {
    return this.store.parkedBlobKeys();
  }

  private async replay(
    id: string,
    rename: string | undefined,
    into: TrashRestoreResult
  ): Promise<void> {
    await this.context.withWriteLock(async () => {
      const entry = await this.store.receipt(id);
      const receipt = entry.data as TrashReceipt;
      if (receipt.state !== "parked") {
        throw new ConflictError(`trash item "${id}" is ${receipt.state}; try again shortly`);
      }
      await this.store.putReceipt(id, { ...receipt, state: "restoring" }, entry.created_at as Date);
      try {
        await this.restorer.replay(id, receipt.subject_id, rename, into);
        await this.store.putReceipt(id, { ...receipt, state: "restoring", ...(rename ? { restore_rename: rename } : {}) }, entry.created_at);
        await this.store.deleteItems(id);
        await this.store.deleteReceipt(id);
      } catch (error) {
        const current = await this.store.findReceipt(id);
        if (current) await this.store.putReceipt(id, { ...current.data as TrashReceipt, state: "parked" }, entry.created_at);
        throw error;
      }
    });
  }

  /** The receipts to replay, ancestors first. One unless `chain`. */
  private async chainFor(subject: TrashView, chain: boolean): Promise<TrashView[]> {
    const order: TrashView[] = [];
    let current: string | null = subject.id;
    const seen = new Set<string>();

    while (current && !seen.has(current)) {
      seen.add(current);
      const view: TrashView = current === subject.id ? subject : await this.get(current);
      order.unshift(view);
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

  private async toView(id: string, receipt: TrashReceipt, blockers: TrashBlockers): Promise<TrashView> {
    const blocker = await blockers.blockerFor(receipt);
    return {
      ...TrashService.publicReceipt(receipt),
      id,
      restorable: !blocker && receipt.state === "parked",
      ...(blocker ? { blocked_by: blocker } : {}),
    };
  }

  private static publicReceipt(receipt: TrashReceipt): Omit<TrashReceipt, "restore_rename"> {
    const { restore_rename: _rename, ...view } = receipt;
    return view;
  }

  /** The receipt as every reader of the trash sees it: who may read it, who
   *  may restore it and what the filters match all follow a rename. */
  private static async withCurrentNames(entry: Entry, locator: TrashLocator): Promise<TrashReceipt> {
    const receipt = entry.data as TrashReceipt;
    return { ...receipt, origin: await locator.currentNames(receipt.origin) };
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
