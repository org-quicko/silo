import type { CollectionRecord } from "../../../core/domain/collection-record";
import type { Entry } from "../../../core/domain/entry";
import type { EnvironmentRecord } from "../../../core/domain/environment-record";
import type { Meta } from "../../../core/domain/meta";
import type { ProjectRecord } from "../../../core/domain/project-record";
import type { Scope } from "../../../core/domain/scope";
import type { MediaUsage } from "../../../core/media/media-usage";
import type { DerivedIndex } from "../../../core/ports/derived-index";
import type { Storage } from "../../../core/ports/storage";
import type { Query } from "../../../core/query/query";
import { PgCollectionStore } from "./pg-collection-store";
import { PgConnection } from "./pg-connection";
import { PgEntryStore } from "./pg-entry-store";
import { PgMediaReferenceStore } from "./pg-media-reference-store";
import { PgMetaStore } from "./pg-meta-store";
import { PgMigrations } from "./pg-migrations";
import { PgOwnerLock } from "./pg-owner-lock";
import { PgScopeResolver } from "./pg-scope-resolver";
import { PgScopeStore } from "./pg-scope-store";
import { PgTables } from "./pg-tables";

/** How to open the store. */
export interface PgStoreOptions {
  /** A `postgres://` URL. A secret: it may carry the password. */
  url: string;
  /** The schema silo's tables live in; created if missing. */
  schema?: string;
  /** Connections in the pool. */
  poolSize?: number;
  /** What `pg_stat_activity` shows for the pool's connections. */
  applicationName?: string;
}

/**
 * The Postgres adapter: silo's tables in one schema of one database.
 *
 * This class is the `Storage` port and the owner of the pool; the per-table
 * stores hold the behaviour, as in the SQLite adapter. It has no native search
 * engine yet, so it is a plain `Storage` and the runtime answers search with
 * the portable `ScanSearcher` (D30); the entry's search text in `DerivedIndex`
 * is not stored.
 */
export class PgStore implements Storage {
  static readonly DefaultSchema = "silo";
  static readonly DefaultPoolSize = 10;

  private readonly connection: PgConnection;
  private readonly url: string;
  private readonly applicationName: string;
  private readonly tables: PgTables;
  private readonly meta_: PgMetaStore;
  private readonly scopes: PgScopeStore;
  private readonly collections: PgCollectionStore;
  private readonly entries: PgEntryStore;
  private readonly mediaReferences: PgMediaReferenceStore;
  private owner: PgOwnerLock | null = null;
  private closing: Promise<void> | null = null;

  private constructor(
    connection: PgConnection,
    url: string,
    applicationName: string,
    tables: PgTables
  ) {
    this.connection = connection;
    this.url = url;
    this.applicationName = applicationName;
    this.tables = tables;

    const resolver = new PgScopeResolver(connection, tables);
    this.meta_ = new PgMetaStore(connection, tables);
    this.mediaReferences = new PgMediaReferenceStore(connection, tables);
    this.entries = new PgEntryStore(connection, tables, this.meta_, this.mediaReferences, resolver);
    this.scopes = new PgScopeStore(connection, tables, this.entries, resolver);
    this.collections = new PgCollectionStore(connection, tables, resolver, this.scopes);
  }

  /** Connects, checks the server version and the schema's format, and creates
   *  whatever is missing. */
  static async open(options: PgStoreOptions): Promise<PgStore> {
    const tables = PgTables.for(options.schema ?? PgStore.DefaultSchema);
    const applicationName = options.applicationName ?? "silo";
    const connection = PgConnection.open({
      url: options.url,
      max: options.poolSize ?? PgStore.DefaultPoolSize,
      applicationName,
    });
    try {
      await PgMigrations.assertServerVersion(connection);
      await PgMigrations.initialize(connection, tables);
      return new PgStore(connection, options.url, applicationName, tables);
    } catch (error) {
      await connection.close();
      throw error;
    }
  }

  /** The schema this store reads and writes. */
  get schema(): string {
    return this.tables.schema;
  }

  /**
   * Takes the owner lock for this schema, which `serve` holds for its whole
   * life (D25). Refuses when another server holds it. Idempotent.
   */
  async claimOwnership(): Promise<void> {
    this.owner ??= await PgOwnerLock.acquire(this.url, this.tables, this.applicationName);
  }

  /** Releases the owner lock, then drains and closes the pool. Safe to call more than once. */
  async close(): Promise<void> {
    this.closing ??= (async () => {
      await this.owner?.release();
      await this.connection.close();
    })();
    await this.closing;
  }

  async meta(): Promise<Meta> {
    return this.meta_.read();
  }

  async markDefaultsInitialized(): Promise<void> {
    await this.meta_.markDefaultsInitialized();
  }

  async createProject(name: string, id?: string): Promise<ProjectRecord> {
    return this.scopes.createProject(name, id);
  }

  async listProjects(): Promise<ProjectRecord[]> {
    return this.scopes.listProjects();
  }

  async findProject(name: string): Promise<ProjectRecord | null> {
    return this.scopes.findProject(name);
  }

  async renameProject(id: string, name: string): Promise<void> {
    await this.scopes.renameProject(id, name);
  }

  async deleteProject(name: string): Promise<void> {
    await this.scopes.deleteProject(name);
  }

  async createEnvironment(project: string, env: string, id?: string): Promise<EnvironmentRecord> {
    return this.scopes.createEnvironment(project, env, id);
  }

  async listEnvironments(project: string): Promise<EnvironmentRecord[]> {
    return this.scopes.listEnvironments(project);
  }

  async findEnvironment(project: string, env: string): Promise<EnvironmentRecord | null> {
    return this.scopes.findEnvironment(project, env);
  }

  async renameEnvironment(id: string, name: string): Promise<void> {
    await this.scopes.renameEnvironment(id, name);
  }

  async deleteEnvironment(project: string, env: string): Promise<void> {
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
    await this.collections.rename(id, name);
  }

  async putSchema(
    scope: Scope,
    collection: string,
    schema: any,
    id?: string
  ): Promise<CollectionRecord> {
    return this.collections.put(scope, collection, schema, id);
  }

  async getSchema(scope: Scope, collection: string): Promise<any> {
    return this.collections.get(scope, collection);
  }

  async deleteSchema(scope: Scope, collection: string): Promise<void> {
    await this.collections.delete(scope, collection);
  }

  async put(entry: Entry, derived: DerivedIndex): Promise<void> {
    await this.entries.put(entry, derived);
  }

  async get(scope: Scope, collection: string, id: string): Promise<Entry> {
    return this.entries.get(scope, collection, id);
  }

  async delete(scope: Scope, collection: string, id: string): Promise<void> {
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
}
