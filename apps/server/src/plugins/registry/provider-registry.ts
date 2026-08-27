import path from "path";
import type { Config } from "../../config/config";
import type { BlobStorageConfig } from "../../config/blob-storage-config";
import type { Storage } from "../../core/ports/storage";
import type { BlobStorage } from "../../core/ports/blob-storage";
import { SqliteStore } from "../../adapters/storage/sqlite/sqlite-store";
import { FsStore } from "../../adapters/storage/fs/fs-store";
import { FsBlobStorage } from "../../adapters/blob/fs-blob-storage";
import { S3BlobStorage } from "../../adapters/blob/s3-blob-storage";
import { SearchTokenizers } from "../../core/search/search-tokenizers";
import type { StorageFactory } from "./storage-factory";
import type { BlobFactory } from "./blob-factory";

/**
 * Which driver name builds which adapter (D31/§13.7).
 *
 * The built-ins are registered here under **reserved names** while staying
 * compiled into the binary. That is the trick D12 used for `_keys` and D18 for
 * `Scope.System`: one code path rather than two. A default install needs no
 * network and no configuration, and the registry ships already carrying its
 * most demanding consumers — which is the D7 test, met before any third party
 * sees it.
 *
 * `[storage] driver` becoming a lookup is the whole user-visible change, and it
 * is deliberately none: the same names resolve to the same adapters.
 */
export class ProviderRegistry {
  /** Names a plugin may never take. Shadowing `sqlite` would let an installed
   *  package silently become the store an existing instance already has data
   *  in — a data-loss shape, not a naming inconvenience. */
  static readonly Reserved: readonly string[] = ["sqlite", "fs", "s3"];

  private readonly stores = new Map<string, StorageFactory>();
  private readonly blobs = new Map<string, BlobFactory>();

  static withBuiltins(): ProviderRegistry {
    const registry = new ProviderRegistry();

    registry.stores.set("sqlite", async (config) =>
      await SqliteStore.open(path.join(config.storage.path, "silo.db"), {
        enabled: config.search.enabled,
        tokenizer: SearchTokenizers.sqlite(config.search.tokenizer),
      })
    );
    registry.stores.set("fs", async (config) => await FsStore.open(config.storage.path));

    registry.blobs.set("fs", (config) => new FsBlobStorage(config.path || "./silo_data/media"));
    registry.blobs.set("s3", (config) => {
      if (!config.bucket) throw new Error(`blob driver "s3" requires 'bucket' configuration`);
      return new S3BlobStorage({
        bucket: config.bucket,
        region: config.region,
        endpoint: config.endpoint,
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
        forcePathStyle: config.forcePathStyle,
      });
    });

    return registry;
  }

  registerStorage(driver: string, factory: StorageFactory, from: string): void {
    ProviderRegistry.assertAvailable(driver, this.stores.has(driver), from);
    this.stores.set(driver, factory);
  }

  registerBlob(driver: string, factory: BlobFactory, from: string): void {
    ProviderRegistry.assertAvailable(driver, this.blobs.has(driver), from);
    this.blobs.set(driver, factory);
  }

  async openStorage(config: Config): Promise<Storage> {
    const factory = this.stores.get(config.storage.driver);
    if (!factory) {
      throw new Error(
        `unknown storage driver "${config.storage.driver}". Available: ${[...this.stores.keys()].sort().join(", ")}.`
      );
    }
    return await factory(config);
  }

  openBlob(config: BlobStorageConfig): BlobStorage {
    const driver = (config.driver || "fs").toLowerCase();
    const factory = this.blobs.get(driver);
    if (!factory) {
      throw new Error(
        `unknown blob storage driver "${config.driver}". Available: ${[...this.blobs.keys()].sort().join(", ")}.`
      );
    }
    return factory(config);
  }

  /** Driver names currently registered, for `silo plugin list` and error text. */
  drivers(): { storage: string[]; blob: string[] } {
    return { storage: [...this.stores.keys()].sort(), blob: [...this.blobs.keys()].sort() };
  }

  private static assertAvailable(driver: string, taken: boolean, from: string): void {
    if (ProviderRegistry.Reserved.includes(driver)) {
      throw new Error(
        `plugin "${from}": driver "${driver}" is reserved for a built-in adapter and cannot be replaced.`
      );
    }
    if (taken) {
      throw new Error(`plugin "${from}": driver "${driver}" is already registered by another plugin.`);
    }
  }
}
