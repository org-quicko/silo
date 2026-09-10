import type { MediaAssetRecord } from "./media-asset.js";
import type { MediaAssetPayload } from "./media-asset-payload.js";
import type { MediaUsage } from "./media-usage.js";

/** `MediaAssetMapper.toUsagePage`'s output — one page of an asset's
 *  referrers, mapped. */
export interface MediaUsagePageFields {
  items: MediaUsage[];
  total: number;
  visible: number;
  visibleCapped: boolean;
}

/**
 * The explicit per-type mapper for media: renames only the known wire
 * fields — `size`, `content_type`, `blob_key`, `usage_count`, `env`,
 * `visible_capped` and the two timestamps — and leaves `filename` and `tags`
 * untouched. The one place that maps the wire, reused by every media class
 * and by `MediaInUseError` for its `referrers`.
 */
export class MediaAssetMapper {
  static toRecord(payload: MediaAssetPayload): MediaAssetRecord {
    return {
      id: payload.id,
      filename: payload.filename,
      folder: payload.folder,
      blobKey: payload.blob_key,
      sizeInBytes: payload.size,
      contentType: payload.content_type,
      hash: payload.hash,
      state: payload.state,
      tags: payload.tags,
      url: payload.url,
      usageCount: payload.usage_count ?? 0,
      createdAt: new Date(payload.created_at),
      updatedAt: new Date(payload.updated_at),
    };
  }

  /** Reads defensively: this also backs `MediaInUseError`'s referrers, which
   *  arrive inside an error body rather than a route this client trusts to
   *  shape exactly right. */
  static toUsage(payload: Record<string, unknown>): MediaUsage {
    return {
      mediaId: typeof payload.media_id === "string" ? payload.media_id : "",
      project: typeof payload.project === "string" ? payload.project : "",
      environment: typeof payload.env === "string" ? payload.env : "",
      collection: typeof payload.collection === "string" ? payload.collection : "",
      entryId: typeof payload.entry_id === "string" ? payload.entry_id : "",
    };
  }

  static toUsagePage(body: {
    items: unknown[];
    total: number;
    visible: number;
    visible_capped: boolean;
  }): MediaUsagePageFields {
    return {
      items: body.items.map((item) => MediaAssetMapper.toUsage(item as Record<string, unknown>)),
      total: body.total,
      visible: body.visible,
      visibleCapped: body.visible_capped,
    };
  }
}
