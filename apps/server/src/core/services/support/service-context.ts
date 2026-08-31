import type { MediaConfig } from "../../../config/media-config";
import type { Storage } from "../../ports/storage";
import type { BlobStorage } from "../../ports/blob-storage";
import { MediaExtensions } from "../../media/media-extensions";
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
  readonly schemaRegistry: SchemaRegistry;
  readonly searcher: Searcher;

  /** Serialises every write in the instance. See D25 for why it is enough. */
  readonly writeLock = new AsyncMutex();

  /** A null object until `useHooks` replaces it, so every dispatch site reads
   *  the same whether or not plugins exist (D31/§13.5). */
  private pluginHooks: Hooks = new NoOpHooks();

  /** One cell, read by every media call site through the getter below (D45). */
  private blobs: BlobStorage;

  /**
   * The same arrangement for the media policy (D46): the settings page edits it
   * while the process runs, so it is read at the moment it is used.
   *
   * A service built without one refuses nothing and rewrites no URL. The
   * allowlist a new instance starts with is `MediaDefaults`, applied by
   * `ConfigLoader` — absent any configuration at all, "accept everything" is
   * the only answer that does not invent a policy the caller never set.
   */
  private media: MediaConfig = { base_url_target: "server", extensions: [MediaExtensions.Any] };

  constructor(
    store: Storage,
    blobStorage: BlobStorage,
    schemaRegistry: SchemaRegistry,
    searcher: Searcher
  ) {
    this.store = store;
    this.blobs = blobStorage;
    this.schemaRegistry = schemaRegistry;
    this.searcher = searcher;
  }

  get hooks(): Hooks {
    return this.pluginHooks;
  }

  /** Where media bytes live. A getter rather than a field because it can be
   *  repointed while the process runs (D45) — see `useBlobStorage`. */
  get blobStorage(): BlobStorage {
    return this.blobs;
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

  /**
   * Point media at a different store, and hand back the one it replaces so the
   * caller can close it (D45).
   *
   * One assignment is the whole of it, for `PluginAuthority`'s reason: every
   * media call site reads `context.blobStorage` at the moment it acts, so there
   * is nothing to tear down and nothing to rebuild — a request already inside
   * `get` finishes against the store it started on, and the next one does not.
   *
   * What this does **not** do is move any bytes. An instance repointed from a
   * directory to a bucket has a catalog full of assets the new store has never
   * heard of, which is a fact about object stores rather than something a swap
   * could paper over; the admin says so before it saves.
   */
  useBlobStorage(blobStorage: BlobStorage): BlobStorage {
    const previous = this.blobs;
    this.blobs = blobStorage;
    return previous;
  }

  /** What the library accepts and where its URLs point (D46). A getter for
   *  `blobStorage`'s reason: the settings page can change it mid-process. */
  get mediaConfig(): MediaConfig {
    return this.media;
  }

  /** Replaces the media policy, and hands back the one it replaced so a caller
   *  that has to undo the change can put it back exactly. */
  useMediaConfig(media: MediaConfig): MediaConfig {
    const previous = this.media;
    this.media = media;
    return previous;
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
