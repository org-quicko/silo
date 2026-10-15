/**
 * Where a prepared transfer is in its life (D109).
 *
 * `preparing` while the package is pulled and verified, `prepared` once it can
 * be reviewed, `applying` and `applied` around the one atomic commit, `stale`
 * when the destination changed under the review. `cancelled` and `expired` keep
 * the record and drop the package.
 */
export type PreparedTransferState =
  | "preparing"
  | "prepared"
  | "applying"
  | "applied"
  | "stale"
  | "cancelled"
  | "expired";

export class PreparedTransferStates {
  /** States that hold one of the server's slots. */
  static readonly Open: ReadonlySet<PreparedTransferState> = new Set(["preparing", "prepared", "applying"]);

  /** States whose package is gone and whose record waits only to be removed. */
  static readonly Ended: ReadonlySet<PreparedTransferState> = new Set(["applied", "stale", "cancelled", "expired"]);
}
