import { SqliteStore } from "../../adapters/storage/sqlite/sqlite-store";
import type { Config } from "../../config/config";
import { SiloService } from "../../core/services/silo-service";
import { SearchTokenizers } from "../../core/search/search-tokenizers";
import { Logger } from "../../logging/logger";
import { PluginLoader, PluginRegistry, ProviderRegistry } from "../../plugins";
import type { Storage } from "../../core/ports/storage";

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

  private constructor(
    store: Storage,
    service: SiloService,
    logger: Logger,
    plugins: PluginRegistry
  ) {
    this.store = store;
    this.service = service;
    this.logger = logger;
    this.plugins = plugins;
  }

  /**
   * Opens storage, builds the service, and — for `serve` — loads extension
   * plugins. Throws rather than exiting, so the caller owns the error message
   * and the exit code.
   */
  static async open(config: Config, command: string): Promise<SiloRuntime> {
    const { store, service, rebuildNotice } = await SiloRuntime.openStorage(config);

    // Only `serve` logs: every other subcommand writes *program output* to
    // stdout — data the caller pipes somewhere — and routing that into a log
    // file would take the answer away from whoever asked for it.
    const logger = command === "serve" ? Logger.create(config.log) : Logger.silent();
    if (rebuildNotice && command === "serve") console.error(rebuildNotice);

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

    return new SiloRuntime(store, service, logger, plugins);
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
  private static async openStorage(config: Config): Promise<{
    store: Storage;
    service: SiloService;
    rebuildNotice: string | null;
  }> {
    const providers = ProviderRegistry.withBuiltins();
    // Before storage is opened, because a provider plugin *is* the storage.
    await PluginLoader.loadProviders(PluginRegistry.directory(config), config.plugins, providers);

    const store = await providers.openStorage(config);
    const blobStorage = providers.openBlob(config.blob_storage);

    // The native engine when this build has FTS5 and search is on, the portable
    // one otherwise (D30). `createSearcher` returns null rather than throwing,
    // because a SQLite without FTS5 cannot be repaired at runtime — the shipped
    // build sets OMIT_LOAD_EXTENSION — so it must degrade.
    const tokenizer = SearchTokenizers.sqlite(config.search.tokenizer);
    const searcher =
      store instanceof SqliteStore ? (store.createSearcher(tokenizer) ?? undefined) : undefined;

    const service = new SiloService(store, {
      allowRemoteRefs: config.schema.allow_remote_refs,
      blobStorage,
      searcher,
      scan: {
        visitLimit: config.search.scan_limit,
        timeBudgetMs: config.search.scan_time_budget_ms,
      },
    });

    return { store, service, rebuildNotice: await SiloRuntime.rebuildIndex(store, searcher) };
  }

  /**
   * Fills an index that is missing or stale, **before** the bind — a
   * half-filled index answers with a subset and nothing says so, which is worse
   * than a slow start. Only a stamp change or an empty index triggers it, so a
   * normal start does no work.
   */
  private static async rebuildIndex(
    store: Storage,
    searcher: { reindex: () => Promise<{ collections: number; entries: number }> } | undefined
  ): Promise<string | null> {
    if (!(store instanceof SqliteStore) || !store.needsSearchRebuild() || !searcher) return null;

    const report = await searcher.reindex();
    store.searchRebuilt();
    if (report.entries === 0) return null;
    return `silo: rebuilt the search index (${report.entries} entries in ${report.collections} collections)`;
  }
}
