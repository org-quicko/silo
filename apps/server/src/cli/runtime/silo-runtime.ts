import path from "path";
import type { Config } from "../../config/config";
import { SiloService } from "../../core/services/silo-service";
import { Logger } from "../../logging/logger";
import { PluginLoader, PluginRegistry, PluginSupervisor, ProviderRegistry } from "../../plugins";
import { ConfigSupervisor, MediaPolicySupervisor, MediaStorageSupervisor } from "../../settings";
import type { IndexedStorage } from "../../core/ports/indexed-storage";
import type { MeasuredStorage } from "../../core/ports/measured-storage";
import type { OwnedStorage } from "../../core/ports/owned-storage";
import type { Storage } from "../../core/ports/storage";
import type { StorageMeasurement } from "../../core/ports/storage-measurement";
import type { Searcher } from "../../core/search/searcher";

/**
 * Everything a data-directory subcommand needs, wired from config: the storage
 * and blob providers, the search engine, the service layer, the log, and — for
 * `serve` only — the plugin hook bus.
 *
 * This is §4's "wire everything explicitly from config" in one place, so the
 * router stays a router.
 */
export class SiloRuntime {
  readonly store: Storage;
  readonly service: SiloService;
  readonly logger: Logger;
  readonly plugins: PluginRegistry;

  /** The one thing allowed to change the running plugin set (D39). Built even
   *  when nothing is configured, because `POST /api/plugins/rescan` is how a
   *  first plugin arrives without a restart. */
  readonly supervisor: PluginSupervisor;

  /** The one thing allowed to repoint media storage (D45). It holds the same
   *  `ProviderRegistry` storage was opened from, so the drivers it offers are
   *  this build's plus whatever a provider plugin registered. */
  readonly mediaStorage: MediaStorageSupervisor;

  /** The one thing allowed to change where media URLs point and what the
   *  library accepts (D46). */
  readonly mediaPolicy: MediaPolicySupervisor;

  /** The one thing allowed to rewrite the rest of `silo.toml` (D47). It holds
   *  the config this process **started on**, which is how it can tell a change
   *  waiting for a restart from one already in force. */
  readonly settings: ConfigSupervisor;

  /** What happens when another server takes this one's storage (D25). Until
   *  `serve` installs its orderly shutdown, the process logs and exits. */
  private storageLost: (reason: Error) => void;

  private constructor(
    store: Storage,
    service: SiloService,
    logger: Logger,
    plugins: PluginRegistry,
    supervisor: PluginSupervisor,
    mediaStorage: MediaStorageSupervisor,
    mediaPolicy: MediaPolicySupervisor,
    settings: ConfigSupervisor
  ) {
    this.store = store;
    this.service = service;
    this.logger = logger;
    this.plugins = plugins;
    this.supervisor = supervisor;
    this.mediaStorage = mediaStorage;
    this.mediaPolicy = mediaPolicy;
    this.settings = settings;
    this.storageLost = (reason) => SiloRuntime.abandon(logger, reason);
  }

  /** Replaces what happens when storage ownership is lost; `serve` shuts down. */
  whenStorageLost(handler: (reason: Error) => void): void {
    this.storageLost = handler;
  }

  /** The store's own report, when it keeps one (`MeasuredStorage`), for the
   *  observability snapshot. */
  static measurer(store: Storage): (() => Promise<StorageMeasurement>) | undefined {
    const measured = store as Partial<MeasuredStorage>;
    return typeof measured.measure === "function" ? () => measured.measure!() : undefined;
  }

  /**
   * Opens storage, builds the service, and — for `serve` — loads extension
   * plugins. Throws rather than exiting, so the caller owns the error message
   * and the exit code.
   */
  static async open(
    config: Config,
    command: string,
    reload?: () => Promise<Config>,
    configPath?: string
  ): Promise<SiloRuntime> {
    // Only `serve` logs: every other subcommand writes *program output* to
    // stdout — data the caller pipes somewhere — and routing that into a log
    // file would take the answer away from whoever asked for it.
    //
    // Built before the store, not after, because `SiloService` needs it: an
    // audit append that fails has to be reported somewhere (D38), and a service
    // holding a silent logger would drop that on the floor exactly when it
    // matters.
    const logger = command === "serve" ? Logger.create(config.log) : Logger.silent();
    const { store, service, providers, rebuildNotice } = await SiloRuntime.openStorage(
      config,
      logger
    );

    // Before anything is written — the rename resume below included — because
    // a store another server owns must not be written to at all (D25). A store
    // with no owner lock of its own leaves this to `RunFile`, in `serve`.
    let runtime: SiloRuntime | null = null;
    if (command === "serve") {
      try {
        await SiloRuntime.claim(store, (reason) =>
          runtime ? runtime.storageLost(reason) : SiloRuntime.abandon(logger, reason)
        );
      } catch (error) {
        await store.close().catch(() => {});
        throw error;
      }
    }

    if (rebuildNotice && command === "serve") console.error(rebuildNotice);

    // Before anything can upload or resolve a URL: the service's own default is
    // "no policy", which is the right answer for a service built without a
    // config and the wrong one for a process that was handed one (D46).
    service.useMediaConfig(config.media);

    // What `silo.toml` declares for each plugin, so a rename can refuse rather
    // than leave the config half of a plugin's authority naming a scope that no
    // longer exists. Silo does not rewrite `[[plugins]]` — D34 is explicit that
    // an API able to write that file is a code-execution primitive — so the
    // rename says so and stops (D51).
    service.renames.useDeclaredPluginClaims(
      new Map((config.plugins ?? []).map((plugin) => [plugin.name, plugin.claims ?? []]))
    );

    // Before plugins load, unlike the two media resumes in `serve-command`: a
    // plugin boots on the authority its `_plugins` record holds, so a cascade
    // replayed after it started would leave it running on claims that name a
    // scope which no longer exists (D51).
    const renames = await service.resumePendingRenames();
    if (renames.resumed > 0 || renames.failed > 0) {
      logger.info("finished pending scope renames", {
        resumed: renames.resumed,
        failed: renames.failed,
      });
    }

    // Extension plugins load only for `serve` (D31). Every other subcommand is
    // a one-shot against the data dir, and spinning a worker per plugin to run
    // an export would pay the cold start for hooks that will never fire —
    // `doctor` is the exception, because loading them *is* what it reports on.
    let plugins = PluginRegistry.empty(logger);
    if (command === "serve") {
      try {
        plugins = await PluginRegistry.load(config, service, logger);
        service.useHooks(plugins.hooks());
      } catch (error) {
        // Refuse the start rather than serve without a plugin the operator
        // configured: an instance that looks healthy and has quietly stopped
        // enforcing something is the worse outcome (§13.3).
        await store.close().catch(() => {});
        throw error;
      }
    }

    const supervisor = new PluginSupervisor({
      registry: plugins,
      service,
      logger,
      config,
      reload,
      configPath,
    });

    // A rename rewrites the claims on a plugin's `_plugins` record, and a
    // running plugin holds what it booted with — so it is restarted onto the
    // rewritten grant rather than left acting on a scope that no longer exists
    // (D51). Injected because the supervisor is the only thing that mutates the
    // registry and sits above the service layer.
    service.renames.usePluginRefresh(async (names) => {
      for (const name of names) {
        await supervisor.restart(name).catch((error: unknown) => {
          logger.warn("could not restart plugin after a rename", {
            plugin: name,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }
    });
    // The same `reload` the plugin supervisor gets, deliberately: a save that
    // re-read the file without this process's flags and environment would apply
    // a different configuration than the next `serve` will (D45).
    const mediaStorage = new MediaStorageSupervisor({
      service,
      providers,
      logger,
      config,
      reload,
      configPath,
    });
    const mediaPolicy = new MediaPolicySupervisor({
      service,
      logger,
      config,
      reload,
      configPath,
    });
    const settings = new ConfigSupervisor({
      service,
      logger,
      config,
      reload,
      configPath,
    });
    runtime = new SiloRuntime(
      store,
      service,
      logger,
      plugins,
      supervisor,
      mediaStorage,
      mediaPolicy,
      settings
    );
    return runtime;
  }

  async close(): Promise<void> {
    await this.logger.close().catch(() => {});
    await this.store.close().catch(() => {});
  }

  /**
   * Storage goes through the provider registry (D31/§13.7). The built-ins are
   * registered under reserved names rather than branched on here, so a
   * third-party adapter reaches the same lookup the shipped ones do — and a
   * default install still resolves "sqlite" to `SqliteStore` with no plugin, no
   * network and no configuration.
   */
  private static async openStorage(config: Config, logger: Logger): Promise<{
    store: Storage;
    service: SiloService;
    /** Handed back rather than discarded: `MediaStorageSupervisor` opens the
     *  next blob store through the same registry this one came from, so a
     *  provider plugin's driver stays selectable afterwards (D45). */
    providers: ProviderRegistry;
    rebuildNotice: string | null;
  }> {
    const providers = ProviderRegistry.withBuiltins();
    // Before storage is opened, because a provider plugin *is* the storage.
    await PluginLoader.loadProviders(PluginRegistry.directory(config), config.plugins, providers);

    const store = await providers.openStorage(config);
    const blobStorage = providers.openBlob(config.blob_storage);

    // The store's own engine when it keeps an index, the portable one otherwise
    // (D30, D92). `createSearcher` returns null rather than throwing, because a
    // SQLite without FTS5 cannot be repaired at runtime — the shipped build sets
    // OMIT_LOAD_EXTENSION — so it must degrade.
    const indexed = SiloRuntime.indexed(store);
    const searcher = indexed?.createSearcher() ?? undefined;

    const service = new SiloService(store, {
      allowRemoteRefs: config.schema.allow_remote_refs,
      logger,
      blobStorage,
      searcher,
      // Beside the data, not in the platform temp directory: an archive is
      // unpacked before it is walked, and on a hardened unit `/tmp` is a
      // RAM-backed tmpfs while the data directory is the disk provisioned for
      // exactly this much content (§7.2).
      stagingDir: path.join(config.storage.path, "transfer"),
      // What a streamed archive may weigh and expand to (D85); a file named on
      // the command line is the operator's and is not held to it.
      transfer: config.transfer,
      scan: {
        visitLimit: config.search.scan_limit,
        timeBudgetMs: config.search.scan_time_budget_ms,
      },
    });

    return {
      store,
      service,
      providers,
      rebuildNotice: await SiloRuntime.rebuildIndex(indexed, searcher),
    };
  }

  /** Claims the store for this process when it has an owner lock (`OwnedStorage`). */
  private static async claim(store: Storage, lost: (reason: Error) => void): Promise<void> {
    const owned = store as Partial<OwnedStorage>;
    if (typeof owned.claimOwnership === "function") await owned.claimOwnership(lost);
  }

  /** Nothing may write without ownership, and nothing here can stop the writes
   *  more surely than ending the process. */
  private static abandon(logger: Logger, reason: Error): void {
    try {
      logger.error("fatal: lost ownership of storage", { message: reason.message });
    } finally {
      process.exit(1);
    }
  }

  /** The store as one that keeps its own search index, or null (D92). */
  private static indexed(store: Storage): IndexedStorage | null {
    return typeof (store as Partial<IndexedStorage>).createSearcher === "function"
      ? (store as IndexedStorage)
      : null;
  }

  /**
   * Fills an index that is missing or stale, **before** the bind — a
   * half-filled index answers with a subset and nothing says so, which is worse
   * than a slow start. Only a stamp change or an empty index triggers it, so a
   * normal start does no work.
   */
  private static async rebuildIndex(
    store: IndexedStorage | null,
    searcher: Searcher | undefined
  ): Promise<string | null> {
    if (!store || !searcher || !store.needsSearchRebuild()) return null;

    const report = await searcher.reindex();
    store.searchRebuilt();
    if (report.entries === 0) return null;
    return `silo: rebuilt the search index (${report.entries} entries in ${report.collections} collections)`;
  }
}
