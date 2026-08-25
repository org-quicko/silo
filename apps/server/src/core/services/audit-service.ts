import { monotonicFactory } from "ulidx";
import { JsonPath } from "@silo/shared/json-path";
import type { AuditAction } from "../audit/audit-action";
import type { AuditActor } from "../audit/audit-actor";
import type { AuditEvent } from "../audit/audit-event";
import { AuditUtils } from "../audit/audit-utils";
import type { Entry } from "../domain/entry";
import { EntryUtils } from "../domain/entry-utils";
import { Scope } from "../domain/scope";
import type { Logger } from "../../logging/logger";
import type { ServiceContext } from "./support/service-context";

/**
 * The trail of authority changes (D38).
 *
 * Every service that changes who may do what writes here, and nothing writes
 * here for any other reason. That narrowness is what makes the log usable: an
 * instance that grants a plugin twice a year has a two-line history, and a
 * question like "who gave this key `entries:delete`" has one place to look.
 *
 * There is no update and no delete. Retention is deliberately unbounded — an
 * authority log grows with **decisions**, not with traffic, so the pruning that
 * a request log would need here would only ever discard the oldest evidence.
 */
export class AuditService {
  /** A page bound, not a retention bound. Deep history is reachable by paging. */
  static readonly MaxLimit = 500;

  /**
   * A **monotonic** ULID factory, unlike `EntryUtils.newID`.
   *
   * Plain `ulid()` re-randomises its suffix on every call, so two ids minted in
   * the same millisecond sort either way — and `at` ties there too, which leaves
   * "newest first" undefined for exactly the burst a trail is most likely to
   * record: a grant and the key rotation it caused. A monotonic factory
   * increments the suffix instead, so id order *is* insertion order.
   *
   * Local to the trail rather than pushed into `EntryUtils`: entry ids have no
   * ordering requirement, and a shared monotonic generator would make every
   * collection pay for a property only this one reads.
   */
  private static readonly nextId = monotonicFactory();

  private readonly context: ServiceContext;
  private readonly logger: Logger;

  constructor(context: ServiceContext, logger: Logger) {
    this.context = context;
    this.logger = logger;
  }

  /**
   * Append one event.
   *
   * **Called after the change it describes, and never allowed to undo it.** The
   * `Storage` port has no cross-collection transaction, so the choice is between
   * a change that might go unlogged and a caller told its change failed when it
   * succeeded. The second is worse: it invites a retry against state that has
   * already moved. A failure to append is therefore logged at `error` — loudly,
   * because a silent gap in an audit trail is the one failure mode that makes
   * the whole thing worthless — and swallowed.
   */
  async record(
    action: AuditAction,
    actor: AuditActor,
    subject: string,
    detail: Record<string, unknown> = {}
  ): Promise<void> {
    const now = EntryUtils.now();
    const event: AuditEvent = { at: now.toISOString(), action, actor, subject, detail };
    const entry: Entry = {
      id: AuditService.nextId(),
      project: Scope.System.project,
      env: Scope.System.env,
      collection: AuditUtils.AuditCollection,
      rev: 1,
      seq: 0,
      created_at: now,
      updated_at: now,
      data: event,
    };

    try {
      await this.context.withWriteLock(() =>
        this.context.store.put(entry, { usages: [], search: null })
      );
    } catch (caught) {
      this.logger.error("audit append failed — this change is not in the trail", {
        action,
        subject,
        message: caught instanceof Error ? caught.message : String(caught),
      });
    }
  }

  /**
   * Newest first, which is the only order anyone reads a trail in.
   *
   * Sorted by the id rather than by `$.data.at`: the ids are monotonic (see
   * `nextId`) and the millisecond timestamp is not, so two events in the same
   * tick come back in the order they were appended.
   */
  async list(options: { limit?: number; offset?: number; subject?: string } = {}): Promise<{
    items: AuditEvent[];
    total: number;
    limit: number;
    offset: number;
  }> {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), AuditService.MaxLimit);
    const offset = Math.max(options.offset ?? 0, 0);

    const page = await this.context.store.list(Scope.System, AuditUtils.AuditCollection, {
      ...(options.subject
        ? { filter: { op: "eq" as const, path: "$.data.subject", value: options.subject } }
        : {}),
      sort: [{ path: JsonPath.Id, desc: true }],
      limit,
      offset,
    });

    return {
      items: page.items.map((entry) => entry.data as AuditEvent),
      total: page.total,
      limit,
      offset,
    };
  }
}
