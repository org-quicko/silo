import type { Storage } from "../../ports/storage";
import type { BlobStorage } from "../../ports/blob-storage";
import type { Searcher } from "../../search/searcher";
import type { Hooks } from "../../hooks/hooks";
import { NoOpHooks } from "../../hooks/no-op-hooks";
import { AsyncMutex } from "./async-mutex";
import { SchemaRegistry } from "./schema-registry";

/**
 * What every service in this directory shares: the two ports, the schema
 * cache, the instance-wide write lock, the search engine, and the plugin hook
 * bus.
 *
 * One object rather than five constructor arguments per service, and the one
 * place `writeLock` lives — the lock is process-local by design (D25), so it
 * only serialises writes if there is exactly one of it.
 */
export class ServiceContext {
  readonly store: Storage;
  readonly blobStorage: BlobStorage;
  readonly schemaRegistry: SchemaRegistry;
  readonly searcher: Searcher;

  /** Serialises every write in the instance. See D25 for why it is enough. */
  readonly writeLock = new AsyncMutex();

  /** A null object until `useHooks` replaces it, so every dispatch site reads
   *  the same whether or not plugins exist (D31/§13.5). */
  private pluginHooks: Hooks = new NoOpHooks();

  constructor(
    store: Storage,
    blobStorage: BlobStorage,
    schemaRegistry: SchemaRegistry,
    searcher: Searcher
  ) {
    this.store = store;
    this.blobStorage = blobStorage;
    this.schemaRegistry = schemaRegistry;
    this.searcher = searcher;
  }

  get hooks(): Hooks {
    return this.pluginHooks;
  }

  /**
   * Attaches the plugin hook bus (D31).
   *
   * Deliberately a second step rather than a constructor argument: a plugin's
   * context calls back into the service, so the two cannot both be built
   * first. Read through the getter above at every dispatch site, so a later
   * attach is visible to services built before it.
   */
  useHooks(hooks: Hooks): void {
    this.pluginHooks = hooks;
  }

  /** Runs `work` with the instance write lock held. */
  async withWriteLock<T>(work: () => Promise<T>): Promise<T> {
    const release = await this.writeLock.acquire();
    try {
      return await work();
    } finally {
      release();
    }
  }
}
