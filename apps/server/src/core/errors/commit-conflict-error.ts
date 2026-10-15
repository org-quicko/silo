import type { CommitPrecondition } from "../ports/commit-precondition";
import { ConflictError } from "./conflict-error";

/** A commit's preconditions no longer hold, so nothing was written (D107). */
export class CommitConflictError extends ConflictError {
  /** How many conflicts the message names; `conflicts` keeps them all. */
  private static readonly Named = 5;

  readonly conflicts: readonly CommitPrecondition[];

  constructor(conflicts: readonly CommitPrecondition[]) {
    const named = conflicts.slice(0, CommitConflictError.Named).map(CommitConflictError.describe);
    const more = conflicts.length - named.length;
    super(
      `the data this change was planned against has changed: ${named.join("; ")}` +
        (more > 0 ? ` and ${more} more` : "")
    );
    this.name = "CommitConflictError";
    this.conflicts = conflicts;
  }

  private static describe(precondition: CommitPrecondition): string {
    const address = `${precondition.scope.key()}/${precondition.collection}`;
    if (precondition.kind === "entry") return `entry ${address}/${precondition.id}`;
    if (precondition.kind === "collection") return `collection ${address}`;
    return `the entries of ${address}`;
  }
}
