import { ValidationError } from "@silo/shared/validation-error";
import { MediaPaths } from "../../media/media-paths";
import type { MediaAsset } from "../../media/media-asset";

/** The fields a rename, move or retag may change. Everything else about an
 *  asset — its bytes, hash, size and content type — is fixed at upload. */
export interface MediaAssetPatchInput {
  filename?: unknown;
  folder?: unknown;
  tags?: unknown;
}

/** Applies an edit to a catalog record, validating each field it touches. */
export class MediaAssetPatch {
  static apply(asset: MediaAsset, patch: MediaAssetPatchInput): MediaAsset {
    const next: MediaAsset = { ...asset };

    if (patch.filename !== undefined) {
      next.filename = MediaPaths.normalizeFilename(patch.filename, asset.filename);
    }
    if (patch.folder !== undefined) {
      next.folder = MediaPaths.normalizeFolder(patch.folder);
    }
    if (patch.tags !== undefined) {
      next.tags = MediaAssetPatch.normalizeTags(patch.tags);
    }
    return next;
  }

  private static normalizeTags(tags: unknown): string[] {
    if (!Array.isArray(tags) || tags.some((tag) => typeof tag !== "string")) {
      throw new ValidationError("tags must be an array of strings");
    }
    return [...new Set(tags as string[])]
      .map((tag) => tag.trim())
      .filter(Boolean)
      .sort();
  }
}
