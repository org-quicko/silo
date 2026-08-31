import { ConflictError } from "./conflict-error";

/**
 * A media asset was asked to be deleted while entries still reference it
 * (D23). Refused unless the caller opts into `force` (D48), which skips this
 * check and leaves the dangling references for the read path to answer
 * `null` for, rather than a refusal nobody can get past — so the message
 * says the delete is refused, not that it is impossible.
 *
 * It carries the *true* total rather than a visible one. Media is
 * instance-global but referrers are scoped, so the count and the enumerable
 * rows are answered separately: the caller always learns that a file is in
 * use and how widely, and learns *where* only for the scopes its key may read
 * (§8.1). Reporting a filtered count instead would tell a project-confined
 * key that a file is unused when it is not.
 */
export class MediaInUseError extends ConflictError {
  readonly mediaId: string;
  readonly usageCount: number;

  constructor(mediaId: string, usageCount: number) {
    super(
      `media asset "${mediaId}" is referenced by ${usageCount} ${
        usageCount === 1 ? "entry" : "entries"
      }`
    );
    this.name = "MediaInUseError";
    this.mediaId = mediaId;
    this.usageCount = usageCount;
  }
}
