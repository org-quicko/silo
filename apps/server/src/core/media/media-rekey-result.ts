/**
 * What `silo media rekey` moved (D88).
 *
 * D88 made a blob key the request path — `media/<id>` — so that a bucket
 * holding the object can answer `/media/<id>` itself, with silo behind it as a
 * failover rather than in front of it as a proxy. Keys written before it are
 * `<id><ext>`, which no bucket can match against that path. They go on working,
 * because `blob_key` is stored on the record rather than derived from the id,
 * so nothing is broken and nothing is urgent: what an un-rekeyed asset costs is
 * that it is still served by silo when it could have been served by the store.
 *
 * This is the one-off that moves them, and it is safe to run again. Each asset
 * is copied to its new key, the record is pointed at the copy, and only then is
 * the old object removed — so an interrupted run leaves either a duplicate
 * object or an orphaned one, both of which the next run settles, and never a
 * record pointing at bytes that are not there.
 */
export interface MediaRekeyResult {
  /** Assets whose bytes were copied and whose record now names the new key. */
  moved: number;
  /** Assets already on the key D88 gives them, so nothing was done. */
  current: number;
  /**
   * Assets whose bytes were written back unmoved, under `--rewrite`, so the
   * object carries the headers silo would put on it today.
   *
   * Separate from `moved` because it is a different repair: the key was already
   * right and what was stale was `Content-Disposition`, which an object written
   * before silo started sending it does not have and which nothing can detect
   * from outside -- `BlobStorage` reports a key's bytes and its type, never how
   * it was told to present them. So this is asked for rather than found.
   */
  rewritten: number;
  /**
   * Assets whose record named bytes the store does not hold, so there was
   * nothing to copy. Left exactly as they are: a record with no blob is
   * `reconcile`'s to judge, not this command's.
   */
  missing: number;
  /**
   * Old objects removed after their record was repointed, including ones a
   * previous interrupted run had already copied.
   */
  removed: number;
  /**
   * Assets that could not be moved, by id, with the reason. The run continues
   * past each one: a bucket that refuses a single object should not stop the
   * rest of a library from moving.
   */
  failed: { id: string; reason: string }[];
}
