import { ValidationError } from "@silo/shared/validation-error";
import { MediaCatalog } from "../../media/media-catalog";
import { MimeUtils } from "../../media/mime-utils";
import type { MediaBytes } from "../../media/media-bytes";
import type { ServiceContext } from "../support/service-context";
import type { MediaCatalogStore } from "./media-catalog-store";

/** Serves an asset's bytes to a public request. */
export class MediaDelivery {
  private readonly context: ServiceContext;
  private readonly catalog: MediaCatalogStore;

  constructor(context: ServiceContext, catalog: MediaCatalogStore) {
    this.context = context;
    this.catalog = catalog;
  }

  /**
   * Resolves a catalog id first, then falls back to a raw blob key so pre-D23
   * `/media/<blobKey>` URLs still serve while an instance is being backfilled.
   */
  async bytes(idOrKey: string): Promise<MediaBytes | null> {
    if (idOrKey.includes("..") || idOrKey.includes("/") || idOrKey.includes("\\")) {
      throw new ValidationError("invalid media identifier");
    }

    const catalogued = await this.catalog.findAsset(idOrKey);
    if (catalogued) {
      const asset = MediaCatalog.toAsset(catalogued);
      const blob = await this.context.blobStorage.get(asset.blob_key);
      if (!blob) return null;
      return {
        data: blob.data,
        contentType: asset.content_type || blob.contentType,
        size: blob.size,
        filename: asset.filename,
        hash: asset.hash,
      };
    }

    const blob = await this.context.blobStorage.get(idOrKey);
    if (!blob) return null;
    return {
      data: blob.data,
      contentType: blob.contentType || MimeUtils.lookup(idOrKey),
      size: blob.size,
      filename: idOrKey,
    };
  }
}
