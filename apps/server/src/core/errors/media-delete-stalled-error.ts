/**
 * A media deletion was staged but the blob store refused to delete the bytes
 * (D23).
 *
 * The asset is now in `deleting`: not gone, not usable, and refusing new
 * references. That state is recoverable — `silo media reconcile` retries the
 * delete and, if it fails again, returns the asset to `active` — but nothing
 * about a bare `500` says so, and the operator most likely to hit this is
 * driving the API rather than reading the server's startup log. So the failure
 * carries its own remedy.
 *
 * Distinct from `MediaInUseError`: that one is a refusal, and the caller fixes
 * it by editing entries. This one is a storage failure, and the caller fixes it
 * by fixing the blob store's credentials or permissions.
 */
export class MediaDeleteStalledError extends Error {
  readonly mediaId: string;
  readonly blobKey: string;
  readonly reason: string;

  constructor(mediaId: string, blobKey: string, cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(
      `media asset "${mediaId}" is staged for deletion but its file could not be removed from blob storage (${reason}). ` +
        `The asset is not deleted and cannot be referenced until this is resolved. ` +
        `Fix the blob store's credentials or permissions and delete again, or run "silo media reconcile" to return the asset to active.`
    );
    this.name = "MediaDeleteStalledError";
    this.mediaId = mediaId;
    this.blobKey = blobKey;
    this.reason = reason;
    this.cause = cause;
  }
}
