import type { CommitPrecondition } from "./commit-precondition";
import type { CommitWrite } from "./commit-write";

/**
 * Writes that land together or not at all, once every precondition holds
 * (D107). An `entry` precondition with `seq: null` on a row the change set
 * also writes is how a caller makes a commit happen at most once.
 */
export interface ChangeSet {
  preconditions: readonly CommitPrecondition[];
  writes: readonly CommitWrite[];
}
