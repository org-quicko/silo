import { FsBlobStorage } from "../../adapters/blob/fs-blob-storage";
import type { MediaConfig } from "../../config/media-config";
import { Logger } from "../../logging/logger";
import type { Meta } from "../domain/meta";
import type { Hooks } from "../hooks/hooks";
import type { BlobStorage } from "../ports/blob-storage";
import type { Storage } from "../ports/storage";
import type { SchemaValidatorOptions } from "../schema/schema-validator";
import { ScanSearcher } from "../search/scan-searcher";
import type { Searcher } from "../search/searcher";
import { AuditService } from "./audit-service";
import { CollectionService } from "./collection-service";
import { EntryService } from "./entry-service";
import { KeyService } from "./key-service";
import { MediaService } from "./media/media-service";
import { PluginGrantService } from "./plugin-grant-service";
import { ScopeService } from "./scope-service";
import { SearchService } from "./search-service";
import { SchemaRegistry } from "./support/schema-registry";
import { ServiceContext } from "./support/service-context";
import { TransferService } from "./transfer-service";

/** How to build a `SiloService`. Everything is optional; the defaults are what
 *  a plain source checkout runs with. */
export interface SiloServiceOptions extends SchemaValidatorOptions {
  /** Where the default filesystem blob store keeps its files. Ignored when
   *  `blobStorage` is given. */
  mediaDir?: string;
  blobStorage?: BlobStorage;
  /** A native engine when the adapter has one; otherwise the portable scan. */
  searcher?: Searcher;
  /** Bounds for the portable engine; ignored when a native one is given. */
  scan?: { visitLimit?: number; timeBudgetMs?: number };
  /** Where an audit append that fails is reported (D38). Silent by default, so
   *  a test or an embedder does not have to opt out of output it never asked
   *  for; `Cli` passes the real one. */
  logger?: Logger;
}

/**
 * The application service layer: everything the HTTP routes and the CLI act
 * through, grouped by what it acts on.
 *
 * This class owns no behaviour of its own beyond wiring. Each field below is a
 * service with one subject — `service.entries.create(...)`,
 * `service.media.save(...)` — which is what keeps any one of them small enough
 * to read.
 */
export class SiloService {
  readonly store: Storage;

  readonly scopes: ScopeService;
  readonly collections: CollectionService;
  readonly entries: EntryService;
  readonly search: SearchService;
  readonly keys: KeyService;
  /** The trail of authority changes (D38). Every service that changes who may
   *  do what writes here, and nothing else does. */
  readonly audit: AuditService;
  /** Plugin grants and their managed keys (D34). */
  readonly plugins: PluginGrantService;
  readonly media: MediaService;
  readonly transfer: TransferService;

  private readonly context: ServiceContext;

  constructor(store: Storage, options: SiloServiceOptions = {}) {
    const blobStorage =
      options.blobStorage ?? new FsBlobStorage(options.mediaDir || "./silo_data/media");
    // The portable engine is the default rather than an absence, so search
    // works on every adapter without wiring (D30).
    const searcher = options.searcher ?? new ScanSearcher(store, options.scan ?? {});

    this.context = new ServiceContext(
      store,
      blobStorage,
      new SchemaRegistry(store, options),
      searcher
    );

    this.store = store;

    this.collections = new CollectionService(this.context);
    this.scopes = new ScopeService(this.context, this.collections);
    this.media = new MediaService(this.context);
    this.entries = new EntryService(this.context, this.media);
    this.search = new SearchService(this.context);
    this.audit = new AuditService(this.context, options.logger ?? Logger.silent());
    this.keys = new KeyService(this.context, this.audit);
    this.plugins = new PluginGrantService(this.context, this.keys, this.audit);
    this.transfer = new TransferService(this.context);
  }

  /**
   * Attaches the plugin hook bus (D31). A second step rather than a
   * constructor argument because a plugin's context calls back into this
   * service, so the two cannot both be built first — the wiring order stays
   * visible at the one site that does it (`Cli`).
   */
  useHooks(hooks: Hooks): void {
    this.context.useHooks(hooks);
  }

  /** Where media bytes live. Read through the context rather than held here,
   *  because it can be repointed while the process runs (D45). */
  get blobStorage(): BlobStorage {
    return this.context.blobStorage;
  }

  /** Repoint media storage, handing back the store it replaces so the caller
   *  can close it. See `ServiceContext.useBlobStorage`. */
  useBlobStorage(blobStorage: BlobStorage): BlobStorage {
    return this.context.useBlobStorage(blobStorage);
  }

  /** What the library accepts and where its URLs point (D46). */
  get mediaConfig(): MediaConfig {
    return this.context.mediaConfig;
  }

  /** Replaces the media policy, handing back the one it replaces. See
   *  `ServiceContext.useMediaConfig`. */
  useMediaConfig(media: MediaConfig): MediaConfig {
    return this.context.useMediaConfig(media);
  }

  async meta(): Promise<Meta> {
    return this.store.meta();
  }
}
