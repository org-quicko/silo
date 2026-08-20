/**
 * What `silo media reconcile` changed (D23).
 *
 * Reconcile is the standing answer to "the catalog and the blob store have
 * drifted": it backfills records for blobs uploaded before D23, finishes any
 * deletion the process died partway through, and reports bytes nothing in the
 * catalog claims. It never deletes an orphan on its own — that is an operator
 * decision, and a blob with no record is exactly the state a half-finished
 * upload leaves behind.
 */
export interface MediaReconcileResult {
  /** Catalog records created for blobs that had none. */
  adopted: number;
  /** Assets whose blob is gone, so the record was dropped. */
  pruned: number;
  /** Assets left in `deleting` whose delete was carried to completion. */
  finished: number;
  /**
   * Assets returned to `active` because the blob delete failed again.
   *
   * The reverse of the saga's last step, and the only way out of `deleting`
   * that is not a deletion. Without it a permanently failing blob delete — S3
   * credentials rotated, a bucket policy changed — strands an asset forever:
   * unusable, refusing new references, and with no operator path out. This is
   * not a force-delete and does not reopen D21; it is the transition back.
   */
  aborted: number;
  /**
   * Assets still staged after this pass — the deletion failed *and* the abort
   * could not be recorded either. Reported so a stuck asset is visible rather
   * than silent.
   */
  pending: number;
  /** Blob keys no catalog record claims. Reported, never deleted. */
  orphans: string[];
}
