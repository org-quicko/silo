import { MediaRef } from "@silo/shared/media-ref";
import type { Entry } from "../domain/entry";
import type { MediaAsset } from "./media-asset";
import type { MediaAssetView } from "./media-asset-view";

/**
 * The `_media` / `_media_folders` system collections and the mapping between
 * a stored document and the asset the API returns (D23).
 *
 * Both live in `Scope.System` alongside `_keys`, which is what gives them
 * every storage adapter, the export machinery, and the conformance suite for
 * free (D12). Unlike `_keys` they are not credentials, so they are never
 * gated on `--with-keys`: an archive that carried media bytes without their
 * filenames and folders would restore a library with no organisation in it.
 */
export class MediaCatalog {
  static readonly Collection = "_media";
  static readonly FoldersCollection = "_media_folders";

  /** The public URL for an asset — by id, so a rename never invalidates it. */
  static url(id: string): string {
    return `/media/${id}`;
  }

  /** The reference an entry stores to name this asset. */
  static ref(id: string): string {
    return MediaRef.url(id);
  }

  /**
   * The usage tokens that mean "this asset". An asset is referenced by its
   * catalog id, and — on an instance that has not finished backfilling — by
   * the pre-D23 storage path of its blob, so the delete guard has to ask
   * about both.
   */
  static tokens(id: string, blobKey: string): string[] {
    return [id, MediaRef.blobToken(blobKey)];
  }

  static toAsset(e: Entry): MediaAsset {
    const data = (e.data || {}) as Partial<MediaAsset>;
    return {
      filename: typeof data.filename === "string" ? data.filename : "file",
      folder: typeof data.folder === "string" ? data.folder : "",
      blob_key: typeof data.blob_key === "string" ? data.blob_key : "",
      size: typeof data.size === "number" ? data.size : 0,
      content_type:
        typeof data.content_type === "string" ? data.content_type : "application/octet-stream",
      hash: typeof data.hash === "string" ? data.hash : "",
      state: data.state === "deleting" ? "deleting" : "active",
      tags: Array.isArray(data.tags) ? data.tags.filter((t): t is string => typeof t === "string") : [],
    };
  }

  static toView(e: Entry, usageCount?: number): MediaAssetView {
    const asset = MediaCatalog.toAsset(e);
    return {
      ...asset,
      id: e.id,
      url: MediaCatalog.url(e.id),
      created_at: typeof e.created_at === "string" ? e.created_at : e.created_at.toISOString(),
      updated_at: typeof e.updated_at === "string" ? e.updated_at : e.updated_at.toISOString(),
      ...(usageCount === undefined ? {} : { usage_count: usageCount }),
    };
  }

  static folderOf(e: Entry): string {
    const data = (e.data || {}) as { path?: unknown };
    return typeof data.path === "string" ? data.path : "";
  }
}
