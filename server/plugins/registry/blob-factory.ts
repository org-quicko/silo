import type { BlobStorageConfig } from "../../config/blob-storage-config";
import type { BlobStorage } from "../../core/ports/blob-storage";

/** Builds a `BlobStorage`. Synchronous, because none of the shipped blob
 *  adapters opens anything at construction. */
export type BlobFactory = (cfg: BlobStorageConfig) => BlobStorage;
