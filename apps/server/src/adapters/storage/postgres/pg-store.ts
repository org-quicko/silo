import type { CollectionRecord } from "../../../core/domain/collection-record";
import type { Entry } from "../../../core/domain/entry";
import type { EnvironmentRecord } from "../../../core/domain/environment-record";
import type { Meta } from "../../../core/domain/meta";
import type { ProjectRecord } from "../../../core/domain/project-record";
import type { Scope } from "../../../core/domain/scope";
import type { MediaUsage } from "../../../core/media/media-usage";
import type { DerivedIndex } from "../../../core/ports/derived-index";
import type { MeasuredStorage } from "../../../core/ports/measured-storage";
import type { IndexedStorage } from "../../../core/ports/indexed-storage";
import type { OwnedStorage } from "../../../core/ports/owned-storage";
import type { StorageMeasurement } from "../../../core/ports/storage-measurement";
import type { Query } from "../../../core/query/query";
import { PgCollectionStore } from "./pg-collection-store";
import { PgConnection } from "./pg-connection";
import { PgEntryStore } from "./pg-entry-store";
import { PgMediaReferenceStore } from "./pg-media-reference-store";
import { PgMetaStore } from "./pg-meta-store";
import { PgMigrations } from "./pg-migrations";
import { PgOwnerLock } from "./pg-owner-lock";
import { PgScanGate } from "./pg-scan-gate";
import { PgSearchDocumentStore } from "./pg-search-document-store";
import { PgSearchIndex } from "./pg-search-index";
import type { PgSearchTokenizer } from "./pg-search-tokenizer";
import { PgSearcher } from "./pg-searcher";
import { PgScopeResolver } from "./pg-scope-resolver";
import { PgScopeStore } from "./pg-scope-store";
import { PgStartup } from "./pg-startup";
import { PgTables } from "./pg-tables";

/**
 * How to open the store. Durations are in seconds, as `[storage]` states them,
 * except the two below that only tests shorten.
 */
export interface PgStoreOptions {
  /** A `postgres://` URL. A secret: it may carry the password. */
  url: string;
  /** The schema silo's tables live in; created if missing. */
  schema?: string;
  /** Connections in the pool. */
  poolSize?: number;
  /** What `pg_stat_activity` shows for the pool's connections. */
  applicationName?: string;
  connectTimeout?: number;
  /** How long `open` keeps retrying a server that is not there yet. Unset, it does not wait. */
  startupWait?: number;
  idleTimeout?: number;
  maxLifetime?: number;
  statementTimeout?: number;
  idleInTransactionTimeout?: number;
  /** Scans that may wait for a connection before one is refused. */
  scanQueue?: number;
  /** Milliseconds between checks of the owner lock. */
  heartbeatMs?: number;
  /** Milliseconds `close` waits for work in flight. Inside `serve`'s five-second exit. */
  closeGraceMs?: number;
  /** `[search]`: whether the store keeps an index, and how it splits text. On, with `unicode61`, when unset. */
  search?: { enabled: boolean; tokenizer: PgSearchTokenizer };
}

/**
 * The Postgres adapter: silo's tables in one schema of one database.
 *
 * This class is the `Storage` port and the owner of the pool; the per-table
 * stores hold the behaviour, as in the SQLite adapter. With search on it keeps
 * an index inside its own writes and offers `PgSearcher` over it
 * (`IndexedStorage`, D30); with search off it keeps none, and the runtime falls
 * back to `ScanSearcher`.
 *
 * It owns its data the way `serve` needs (`OwnedStorage`, D25) and reports on
 * its pool (`MeasuredStorage`). Every write first asks the owner lock, when
 * one was claimed, so nothing is written while it is being taken back.
 */
export class PgStore implements OwnedStorage, MeasuredStorage, IndexedStorage {
  static readonly DefaultSchema = "silo";
  static readonly DefaultPoolSize = 10;
  static readonly DefaultHeartbeatMs = 10_000;
  static readonly DefaultCloseGraceMs = 4_000;

  private readonly connection: PgConnection;
  private readonly options: PgStoreOptions;
  private readonly applicationName: string;
  private readonly tables: PgTables;
  private readonly scans: PgScanGate;
  private readonly meta_: PgMetaStore;
  private readonly scopes: PgScopeStore;
  private readonly collections: PgCollectionStore;
  private readonly entries: PgEntryStore;
  private readonly mediaReferences: PgMediaReferenceStore;
  private readonly search: { enabled: boolean; tokenizer: PgSearchTokenizer };
  private owner: PgOwnerLock | null = null;
  private closing: Promise<void> | null = null;
  /** Set when the index has to be refilled before it can answer anything. */
  private rebuildDue: boolean;

  private constructor(
    connection: PgConnection,
    options: PgStoreOptions,
    applicationName: string,
    tables: PgTables,
    rebuildDue: boolean
  ) {
    this.connection = connection;
    this.options = options;
    this.applicationName = applicationName;
    this.tables = tables;
    this.search = PgStore.searchOf(options);
    this.rebuildDue = rebuildDue;
    this.scans = PgScanGate.forPool(options.poolSize ?? PgStore.DefaultPoolSize, options.scanQueue);

    const resolver = new PgScopeResolver(connection, tables);
    this.meta_ = new PgMetaStore(connection, tables);
    this.mediaReferences = new PgMediaReferenceStore(connection, tables);
    this.entries = new PgEntryStore(
      connection,
      tables,
      this.meta_,
      this.mediaReferences,
      resolver,
      this.scans,
      new PgSearchDocumentStore(tables, this.search.enabled, this.search.tokenizer)
    );
    this.scopes = new PgScopeStore(connection, tables, this.entries, resolver);
    this.collections = new PgCollectionStore(connection, tables, resolver, this.scopes);
  }

  /** Connects — waiting up to `startupWait` for a server that is not there
   *  yet — checks the version and the schema's format, and creates whatever
   *  is missing. */
  static async open(options: PgStoreOptions): Promise<PgStore> {
    const tables = PgTables.for(options.schema ?? PgStore.DefaultSchema);
    const applicationName = options.applicationName ?? "silo";
    const connection = PgConnection.open({
      url: options.url,
      max: options.poolSize ?? PgStore.DefaultPoolSize,
      applicationName,
      connectTimeout: options.connectTimeout,
      idleTimeout: options.idleTimeout,
      maxLifetime: options.maxLifetime,
      statementTimeout: options.statementTimeout,
      idleInTransactionTimeout: options.idleInTransactionTimeout,
    });
    try {
      await PgStartup.reach(connection, options.url, options.startupWait ?? 0);
      await PgMigrations.initialize(connection, tables);
      const search = PgStore.searchOf(options);
      // Nothing is dropped when search is off: every CLI command opens the
      // store, and must not destroy the index a running server keeps.
      let rebuildDue = false;
      if (search.enabled) rebuildDue = await PgSearchIndex.install(connection, tables, search.tokenizer);
      else await PgSearchIndex.disable(connection, tables);
      return new PgStore(connection, options, applicationName, tables, rebuildDue);
    } catch (error) {
      await connection.close(0);
      throw error;
    }
  }

  /** The native engine, or null when search is off (D30). */
  createSearcher(): PgSearcher | null {
    if (!this.search.enabled) return null;
    return new PgSearcher(this.connection, this.tables, this, this.search.tokenizer, this.scans);
  }

  /** True when the index exists but has not been filled yet. */
  needsSearchRebuild(): boolean {
    return this.search.enabled && this.rebuildDue;
  }

  searchRebuilt(): void {
    this.rebuildDue = false;
  }

  /** The schema this store reads and writes. */
  get schema(): string {
    return this.tables.schema;
  }

  /**
   * Takes the owner lock for this schema, which `serve` holds for its whole
   * life (D25), and starts its heartbeat. Refuses at once when another server
   * holds it. Idempotent.
   */
  async claimOwnership(lost: (reason: Error) => void = () => {}): Promise<void> {
    this.owner ??= await PgOwnerLock.acquire({
      url: this.options.url,
      tables: this.tables,
      applicationName: this.applicationName,
      heartbeatMs: this.options.heartbeatMs ?? PgStore.DefaultHeartbeatMs,
      lost,
    });
  }

  async measure(): Promise<StorageMeasurement> {
    let bytes: number | null = null;
    try {
      const [row] = await this.connection.query<{ bytes: string }>(
        `SELECT coalesce(sum(pg_total_relation_size(c.oid)), 0) AS bytes
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = $1 AND c.relkind = 'r'`,
        [this.tables.schema]
      );
      bytes = Number(row.bytes);
    } catch {
      // Reported as unknown rather than failing the snapshot it is part of.
    }
    return {
      bytes,
      pool: { ...this.connection.stats(), ...this.scans.stats() },
      owner: this.owner ? this.owner.state : "not_claimed",
    };
  }

  /**
   * Refuses the scans still queued, lets the work in flight finish for up to
   * `closeGraceMs`, closes the pool, and only then gives the owner lock up —
   * so no write of this server's can land after another has taken it. Safe to
   * call more than once.
   */
  async close(): Promise<void> {
    this.closing ??= (async () => {
      this.scans.close();
      await this.connection.close(this.options.closeGraceMs ?? PgStore.DefaultCloseGraceMs);
      await this.owner?.release();
    })();
    await this.closing;
  }

  async meta(): Promise<Meta> {
    return this.meta_.read();
  }

  async markDefaultsInitialized(): Promise<void> {
    this.writing();
    await this.meta_.markDefaultsInitialized();
  }

  async createProject(name: string, id?: string): Promise<ProjectRecord> {
    this.writing();
    return this.scopes.createProject(name, id);
  }

  async listProjects(): Promise<ProjectRecord[]> {
    return this.scopes.listProjects();
  }

  async findProject(name: string): Promise<ProjectRecord | null> {
    return this.scopes.findProject(name);
  }

  async renameProject(id: string, name: string): Promise<void> {
    this.writing();
    await this.scopes.renameProject(id, name);
  }

  async deleteProject(name: string): Promise<void> {
    this.writing();
    await this.scopes.deleteProject(name);
  }

  async createEnvironment(project: string, env: string, id?: string): Promise<EnvironmentRecord> {
    this.writing();
    return this.scopes.createEnvironment(project, env, id);
  }

  async listEnvironments(project: string): Promise<EnvironmentRecord[]> {
    return this.scopes.listEnvironments(project);
  }

  async findEnvironment(project: string, env: string): Promise<EnvironmentRecord | null> {
    return this.scopes.findEnvironment(project, env);
  }

  async renameEnvironment(id: string, name: string): Promise<void> {
    this.writing();
    await this.scopes.renameEnvironment(id, name);
  }

  async deleteEnvironment(project: string, env: string): Promise<void> {
    this.writing();
    await this.scopes.deleteEnvironment(project, env);
  }

  async listScopes(): Promise<Scope[]> {
    return this.scopes.listScopes();
  }

  async listCollections(scope: Scope): Promise<CollectionRecord[]> {
    return this.collections.list(scope);
  }

  async findCollection(scope: Scope, collection: string): Promise<CollectionRecord | null> {
    return this.collections.find(scope, collection);
  }

  async renameCollection(id: string, name: string): Promise<void> {
    this.writing();
    await this.collections.rename(id, name);
  }

  async putSchema(
    scope: Scope,
    collection: string,
    schema: any,
    id?: string
  ): Promise<CollectionRecord> {
    this.writing();
    return this.collections.put(scope, collection, schema, id);
  }

  async getSchema(scope: Scope, collection: string): Promise<any> {
    return this.collections.get(scope, collection);
  }

  async deleteSchema(scope: Scope, collection: string): Promise<void> {
    this.writing();
    await this.collections.delete(scope, collection);
  }

  async put(entry: Entry, derived: DerivedIndex): Promise<void> {
    this.writing();
    await this.entries.put(entry, derived);
  }

  async get(scope: Scope, collection: string, id: string): Promise<Entry> {
    return this.entries.get(scope, collection, id);
  }

  async delete(scope: Scope, collection: string, id: string): Promise<void> {
    this.writing();
    await this.entries.delete(scope, collection, id);
  }

  async list(
    scope: Scope,
    collection: string,
    query: Query
  ): Promise<{ items: Entry[]; total: number }> {
    return this.entries.list(scope, collection, query);
  }

  async listEntryCollections(scope: Scope): Promise<string[]> {
    return this.entries.listCollections(scope);
  }

  async countEntries(scope: Scope): Promise<Map<string, number>> {
    return this.entries.countEntries(scope);
  }

  async listMediaUsages(
    mediaIds: string[],
    page: { limit?: number; offset?: number } = {}
  ): Promise<{ items: MediaUsage[]; total: number }> {
    return this.mediaReferences.list(mediaIds, page);
  }

  async countMediaUsages(mediaIds: string[]): Promise<Map<string, number>> {
    return this.mediaReferences.count(mediaIds);
  }

  /** Refuses a write while the owner lock, once claimed, is not held. */
  private writing(): void {
    this.owner?.assertHeld();
  }

  private static searchOf(options: PgStoreOptions): { enabled: boolean; tokenizer: PgSearchTokenizer } {
    return options.search ?? { enabled: true, tokenizer: "unicode61" };
  }
}
