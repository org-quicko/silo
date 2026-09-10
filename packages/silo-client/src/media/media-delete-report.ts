import { MediaAssetMapper } from "./media-asset-mapper.js";
import type { MediaDeleteFailure } from "./media-delete-failure.js";

/** `POST /api/media/delete`'s always-`200` body: every id's outcome,
 * never a partial result the caller has to infer from a thrown error. */
export class MediaDeleteReport {
  readonly deleted: readonly string[];
  readonly failed: readonly MediaDeleteFailure[];

  private constructor(deleted: string[], failed: MediaDeleteFailure[]) {
    this.deleted = deleted;
    this.failed = failed;
  }

  static fromWireBody(body: { deleted: string[]; failed: Record<string, unknown>[] }): MediaDeleteReport {
    return new MediaDeleteReport(body.deleted, body.failed.map(MediaDeleteReport.toFailure));
  }

  private static toFailure(entry: Record<string, unknown>): MediaDeleteFailure {
    const failure: MediaDeleteFailure = {
      id: String(entry.id),
      code: String(entry.code),
      message: String(entry.message),
    };
    if (typeof entry.usage_count === "number") failure.usageCount = entry.usage_count;
    if (typeof entry.visible_count === "number") failure.visibleCount = entry.visible_count;
    if (typeof entry.visible_capped === "boolean") failure.visibleCapped = entry.visible_capped;
    if (Array.isArray(entry.referrers)) {
      failure.referrers = (entry.referrers as Record<string, unknown>[]).map((usage) => MediaAssetMapper.toUsage(usage));
    }
    return failure;
  }
}
