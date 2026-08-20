import { ConflictError } from "./conflict-error";

/**
 * A media asset was asked to be deleted while entries still reference it
 * (D23). There is no force-delete, so this is terminal until the referrers
 * drop the reference.
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
      } and cannot be deleted`
    );
    this.name = "MediaInUseError";
    this.mediaId = mediaId;
    this.usageCount = usageCount;
  }
}
