import type { Entry } from "../../domain/entry";
import type { Scope } from "../../domain/scope";
import type { WriteContext } from "../../hooks/write-context";

/**
 * The hook payloads an entry write dispatches (D31/§13.5).
 *
 * Partial by design — a hook shapes `data`, never `seq` or the timestamps —
 * and always plain JSON, because a payload may cross a worker boundary.
 */
export class EntryEvents {
  /** What the one mutating hook sees. There is no entry yet, so this is built
   *  from the request rather than from a record. */
  static validating(
    op: "create" | "update",
    writeContext: WriteContext,
    scope: Scope,
    collection: string,
    data: any,
    id?: string
  ) {
    return {
      op,
      origin: writeContext.origin,
      chain: writeContext.chain,
      scope: { project: scope.project, env: scope.env },
      collection,
      ...(id === undefined ? {} : { id }),
      data,
    };
  }

  /** What a veto hook sees, before the write happens. */
  static write(op: "create" | "update", writeContext: WriteContext, entry: Entry) {
    return {
      op,
      origin: writeContext.origin,
      chain: writeContext.chain,
      scope: { project: entry.project, env: entry.env },
      collection: entry.collection,
      id: entry.id,
      rev: entry.rev,
      data: entry.data,
    };
  }

  /** What an observing hook sees, after the write landed. */
  static written(op: "create" | "update", writeContext: WriteContext, entry: Entry) {
    return {
      ...EntryEvents.write(op, writeContext, entry),
      created_at: EntryEvents.isoDate(entry.created_at),
      updated_at: EntryEvents.isoDate(entry.updated_at),
    };
  }

  /** What a delete veto hook sees: the entry it is being asked about. */
  static deleting(writeContext: WriteContext, entry: Entry) {
    return {
      op: "delete" as const,
      origin: writeContext.origin,
      chain: writeContext.chain,
      scope: { project: entry.project, env: entry.env },
      collection: entry.collection,
      id: entry.id,
      rev: entry.rev,
      data: entry.data,
    };
  }

  /** What an observing hook sees after a delete. No `data` — it is gone. */
  static deleted(
    writeContext: WriteContext,
    scope: Scope,
    collection: string,
    id: string,
    rev: number
  ) {
    return {
      op: "delete" as const,
      origin: writeContext.origin,
      chain: writeContext.chain,
      scope: { project: scope.project, env: scope.env },
      collection,
      id,
      rev,
    };
  }

  /** Adapters hand back either a `Date` or the string they stored. */
  private static isoDate(value: Date | string): string {
    return typeof value === "string" ? value : value.toISOString();
  }
}
