import { MediaAssetMapper } from "../media/media-asset-mapper.js";
import type { MediaUsage } from "../media/media-usage.js";
import { ConflictError } from "./conflict-error.js";

/**
 * A `409` refusing to delete a media asset still referenced by entries
 *. Distinct from a plain `ConflictError` because it carries structured
 * facts a caller can act on: the true usage count, how much of it this key
 * may see, and the visible referrers themselves — mapped through
 * `MediaAssetMapper` so the client has one referrer type (`MediaUsage`)
 * rather than a second one local to this error.
 */
export class MediaInUseError extends ConflictError {
  readonly usageCount: number;
  readonly visibleCount: number;
  readonly visibleCapped: boolean;
  readonly referrers: MediaUsage[];

  constructor(
    message: string,
    method: string,
    path: string,
    usageCount: number,
    visibleCount: number,
    visibleCapped: boolean,
    referrers: MediaUsage[],
  ) {
    super(message, method, path, "media_in_use");
    this.name = "MediaInUseError";
    this.usageCount = usageCount;
    this.visibleCount = visibleCount;
    this.visibleCapped = visibleCapped;
    this.referrers = referrers;
    Object.setPrototypeOf(this, MediaInUseError.prototype);
  }

  /** Builds from the wire's `error.details`, which for this code is an
   * OBJECT (`usage_count`, `visible_count`, `visible_capped`, `referrers`),
   * unlike every other error's array-shaped `details`. */
  static fromWireDetails(message: string, method: string, path: string, details: unknown): MediaInUseError {
    const object = (details && typeof details === "object" ? details : {}) as Record<string, unknown>;
    const referrers = Array.isArray(object.referrers)
      ? object.referrers.map((referrer) => MediaAssetMapper.toUsage(referrer as Record<string, unknown>))
      : [];
    return new MediaInUseError(
      message,
      method,
      path,
      typeof object.usage_count === "number" ? object.usage_count : 0,
      typeof object.visible_count === "number" ? object.visible_count : 0,
      object.visible_capped === true,
      referrers,
    );
  }
}
