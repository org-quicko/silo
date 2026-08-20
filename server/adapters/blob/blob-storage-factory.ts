import type { BlobStorage } from "../../core/ports/blob-storage";
import type { BlobStorageConfig } from "../../config/blob-storage-config";
import { FsBlobStorage } from "./fs-blob-storage";
import { S3BlobStorage } from "./s3-blob-storage";

export class BlobStorageFactory {
  static create(cfg: BlobStorageConfig): BlobStorage {
    const driver = (cfg.driver || "fs").toLowerCase();

    switch (driver) {
      case "fs": {
        // The CLI hands over a path already resolved against the data dir
        // (ConfigLoader.resolveDerivedDefaults); this fallback only covers
        // direct construction.
        const basePath = cfg.path || "./silo_data/media";
        return new FsBlobStorage(basePath);
      }

      case "s3": {
        if (!cfg.bucket) {
          throw new Error("S3 blob storage requires 'bucket' configuration");
        }
        return new S3BlobStorage({
          bucket: cfg.bucket,
          region: cfg.region,
          endpoint: cfg.endpoint,
          accessKeyId: cfg.accessKeyId,
          secretAccessKey: cfg.secretAccessKey,
          forcePathStyle: cfg.forcePathStyle,
        });
      }

      default:
        throw new Error(`Unsupported blob storage driver "${cfg.driver}". Supported drivers are "fs" and "s3".`);
    }
  }
}
