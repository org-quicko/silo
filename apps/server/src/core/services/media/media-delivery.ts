import { ValidationError } from "@silo/shared/validation-error";
import { RangeNotSatisfiableError } from "../../errors/range-not-satisfiable-error";
import { ByteRange, type ByteRangeRequest } from "../../media/byte-range";
import { MediaCatalog } from "../../media/media-catalog";
import type { MediaAsset } from "../../media/media-asset";
import type { MediaBytes } from "../../media/media-bytes";
import type { MediaStream } from "../../media/media-stream";
import { MimeUtils } from "../../media/mime-utils";
import type { BlobRange, BlobStream } from "../../ports/blob-storage";
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
   * The asset as a body to send, whole or the `range` of it, read as it goes
   * rather than held (D80). The catalog's `size` is what the range is resolved
   * against, so a bucket is never asked a second question per read.
   *
   * A catalog id first; then a raw blob key, so pre-D23 `/media/<blobKey>`
   * URLs still serve while an instance is being backfilled. That legacy path
   * has no record to take a size from and stays on `get`.
   */
  async open(idOrKey: string, range: ByteRangeRequest | null): Promise<MediaStream | null> {
    MediaDelivery.assertIdentifier(idOrKey);

    const catalogued = await this.catalog.findAsset(idOrKey);
    if (catalogued) {
      const asset = MediaCatalog.toAsset(catalogued);
      const span = MediaDelivery.span(range, asset.size);
      const opened = await this.openBlob(asset.blob_key, span);
      if (!opened) return null;
      return {
        body: opened.body,
        contentType: asset.content_type || opened.contentType || MimeUtils.lookup(asset.blob_key),
        size: asset.size,
        range: span,
        filename: asset.filename,
        hash: asset.hash,
      };
    }

    const blob = await this.context.blobStorage.get(idOrKey);
    if (!blob) return null;
    const span = MediaDelivery.span(range, blob.size);
    return {
      body: new Blob([MediaDelivery.slice(blob.data, span)]),
      contentType: blob.contentType || MimeUtils.lookup(idOrKey),
      size: blob.size,
      range: span,
      filename: idOrKey,
    };
  }

  /** The whole asset in memory, for callers that need the bytes themselves. */
  async bytes(idOrKey: string): Promise<MediaBytes | null> {
    MediaDelivery.assertIdentifier(idOrKey);

    const catalogued = await this.catalog.findAsset(idOrKey);
    if (catalogued) {
      const asset: MediaAsset = MediaCatalog.toAsset(catalogued);
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

  /** `stream` where the store has it; otherwise the bytes, sliced here. */
  private async openBlob(key: string, span: BlobRange | undefined): Promise<BlobStream | null> {
    const store = this.context.blobStorage;
    if (store.stream) return store.stream(key, span);

    const blob = await store.get(key);
    if (!blob) return null;
    return {
      body: new Blob([MediaDelivery.slice(blob.data, span)]),
      size: blob.size,
      contentType: blob.contentType,
    };
  }

  private static span(range: ByteRangeRequest | null, size: number): BlobRange | undefined {
    if (!range) return undefined;
    const span = ByteRange.resolve(range, size);
    if (!span) throw new RangeNotSatisfiableError(size);
    return span;
  }

  private static slice(data: Uint8Array, span: BlobRange | undefined): Uint8Array {
    return span ? data.subarray(span.start, span.end + 1) : data;
  }

  private static assertIdentifier(idOrKey: string): void {
    if (idOrKey.includes("..") || idOrKey.includes("/") || idOrKey.includes("\\")) {
      throw new ValidationError("invalid media identifier");
    }
  }
}
