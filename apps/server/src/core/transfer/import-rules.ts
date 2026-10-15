import type { Entry } from "../domain/entry";

/** What an import does with one collection's schema. */
export interface SchemaDecision {
  /** What a preview calls it. */
  action: "create" | "update" | "unchanged";
  /** Whether the incoming schema is written. */
  write: boolean;
  /** Whether the write must pass `SchemaChangeGuard` first (D70). */
  guarded: boolean;
}

/**
 * The decision rules of an import, in one place (D110): which schema it
 * writes, and which side of an entry wins in merge mode. `Importer` and
 * `TransferPlanner` both ask here, so a sequential import and a planned
 * transfer cannot decide the same input two ways.
 */
export class ImportRules {
  /**
   * `local` is the destination's schema, or undefined when the collection does
   * not exist. Only merge over an existing, different schema is guarded:
   * replace brings every row to the incoming content, and a new collection
   * has nothing to invalidate. `prefer: "local"` keeps the destination's.
   */
  static schema(
    local: unknown,
    incoming: unknown,
    mode: "merge" | "replace",
    prefer?: "local" | "remote"
  ): SchemaDecision {
    if (local === undefined) return { action: "create", write: true, guarded: false };
    if (mode === "replace") return { action: "update", write: true, guarded: false };
    if (JSON.stringify(local) === JSON.stringify(incoming) || prefer === "local") {
      return { action: "unchanged", write: false, guarded: false };
    }
    return { action: "update", write: true, guarded: true };
  }

  /**
   * Whether the incoming entry replaces the destination's in merge mode:
   * `prefer` when given, else the later `updated_at`, then the higher `rev`,
   * then the higher instance id, so two instances agree on every tie.
   */
  static incomingWins(
    local: Pick<Entry, "updated_at" | "rev">,
    incoming: Pick<Entry, "updated_at" | "rev">,
    prefer: "local" | "remote" | undefined,
    incomingInstance: string,
    localInstance: string
  ): boolean {
    if (prefer === "local") return false;
    if (prefer === "remote") return true;
    const incomingTime = incoming.updated_at.getTime();
    const localTime = local.updated_at.getTime();
    if (incomingTime > localTime) return true;
    if (localTime > incomingTime) return false;
    if (incoming.rev > local.rev) return true;
    if (local.rev > incoming.rev) return false;
    return incomingInstance > localInstance;
  }
}
