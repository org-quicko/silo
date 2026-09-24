import { Database } from "bun:sqlite";
import { SqliteConnection } from "./sqlite-connection";
import fs from "fs/promises";
import path from "path";
import type { CollectionRecord } from "../../../core/domain/collection-record";
import type { Entry } from "../../../core/domain/entry";
import type { EnvironmentRecord } from "../../../core/domain/environment-record";
import type { Meta } from "../../../core/domain/meta";
import type { ProjectRecord } from "../../../core/domain/project-record";
import type { Scope } from "../../../core/domain/scope";
import type { MediaUsage } from "../../../core/media/media-usage";
import type { DerivedIndex } from "../../../core/ports/derived-index";
import type { IndexedStorage } from "../../../core/ports/indexed-storage";
import type { Query } from "../../../core/query/query";
import { SearchIndex, type SearchIndexOptions } from "./search-index";
import { SqliteCollectionStore } from "./sqlite-collection-store";
import { SqliteEntryStore } from "./sqlite-entry-store";
import { SqliteMediaReferenceStore } from "./sqlite-media-reference-store";
import { SqliteMetaStore } from "./sqlite-meta-store";
import { SqliteMigrations } from "./sqlite-migrations";
import { SqliteReadWorker } from "./sqlite-read-worker";
import { SqliteScopeResolver } from "./sqlite-scope-resolver";
import { SqliteScopeStore } from "./sqlite-scope-store";
import { SqliteSearchDocumentStore } from "./sqlite-search-document-store";
import { SqliteSearcher } from "./sqlite-searcher";

/** How to open the store; each field has a default `open` explains. */
export interface SqliteStoreOptions {
  /** Run scans on the shared read thread (D81). See `readThreadDefault`. */
  readThread?: boolean;
}

/**
 * The indexed adapter: one SQLite file, with a native FTS5 search index when
 * the build has one.
 *
 * This class is the `Storage` port and the owner of the `Database` handle; the
 * per-table stores below hold the behaviour. Nothing outside this directory
 * sees the handle, which is why `createSearcher` is here rather than in the
 * wiring.
 */
export class SqliteStore implements IndexedStorage {
  private readonly database: SqliteConnection;
  private readonly meta_: SqliteMetaStore;
  private readonly resolver: SqliteScopeResolver;
  private readonly scopes: SqliteScopeStore;
  private readonly collections: SqliteCollectionStore;
  private readonly entries: SqliteEntryStore;
  private readonly mediaReferences: SqliteMediaReferenceStore;

  /**
   * False when search is switched off *or* this SQLite build has no FTS5. The
   * store then keeps no index and `createSearcher` returns null, so the caller
   * falls back to the portable engine (D30).
   */
  private readonly indexing: boolean;

  /** The FTS5 tokenizer the index was opened with, which the engine reads too. */
  private readonly tokenizer: string;

  /** Set when the index has to be refilled before it can answer anything. */
  private rebuildDue: boolean;

  /** The second connection scans run on (D81); `null` for an in-memory database. */
  private readonly reads: SqliteReadWorker | null;

  private constructor(
    database: SqliteConnection,
    indexing: boolean,
    tokenizer: string,
    rebuildDue: boolean,
    reads: SqliteReadWorker | null
  ) {
    this.database = database;
    this.indexing = indexing;
    this.tokenizer = tokenizer;
    this.rebuildDue = rebuildDue;
    this.reads = reads;

    this.meta_ = new SqliteMetaStore(database);
    this.resolver = new SqliteScopeResolver(database);
    this.mediaReferences = new SqliteMediaReferenceStore(database);
    this.entries = new SqliteEntryStore(
      database,
      this.meta_,
      this.mediaReferences,
      new SqliteSearchDocumentStore(database, indexing),
      this.resolver,
      reads
    );
    this.scopes = new SqliteScopeStore(database, this.entries, this.resolver);
    this.collections = new SqliteCollectionStore(database, this.resolver, this.scopes);
  }

  /**
   * Whether scans run on the read thread (D81). `SILO_READ_THREAD=on|off`
   * decides where set; otherwise off under `bun test`, whose `NODE_ENV` is
   * `test`, and on everywhere else. Off under the runner because its
   * `expect(...).rejects` wait does not deliver a `Worker`'s replies once the
   * worker has answered twice before — see the Tests section of
   * docs/context/code-design.md — and the one thread the process shares has
   * always answered twice by the second test. The thread's own test turns it
   * on; the server never runs under the runner.
   */
  static readThreadDefault(): boolean {
    const explicit = process.env.SILO_READ_THREAD;
    if (explicit === "on") return true;
    if (explicit === "off") return false;
    return process.env.NODE_ENV !== "test";
  }

  static async open(
    filePath: string,
    search: SearchIndexOptions = { enabled: true, tokenizer: "unicode61 remove_diacritics 2" },
    options: SqliteStoreOptions = {}
  ): Promise<SqliteStore> {
    const dir = path.dirname(filePath);
    if (dir !== ".") await fs.mkdir(dir, { recursive: true });

    const database = new SqliteConnection(new Database(filePath, { create: true }));
    try {
      SqliteMigrations.applyPragmas(database);
      SqliteMigrations.guardFormatVersion(database);
      SqliteMigrations.initialize(database);
      SqliteMigrations.assertIntegrity(database);

      const indexing = search.enabled && SearchIndex.available(database);
      const readThread = options.readThread ?? SqliteStore.readThreadDefault();
      return new SqliteStore(
        database,
        indexing,
        search.tokenizer,
        SqliteStore.prepareIndex(database, search, indexing),
        readThread ? SqliteReadWorker.for(filePath) : null
      );
    } catch (error) {
      database.close();
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.reads?.close();
    this.database.close();
  }

  async meta(): Promise<Meta> {
    return this.meta_.read();
  }

  async markDefaultsInitialized(): Promise<void> {
    this.meta_.markDefaultsInitialized();
  }

  /** True when the index exists but has not been filled yet. */
  needsSearchRebuild(): boolean {
    return this.indexing && this.rebuildDue;
  }

  searchIndexed(): boolean {
    return this.indexing;
  }

  /**
   * The native engine, or null when this build has no FTS5 or search is off —
   * the caller then uses the portable `ScanSearcher`, which is why a missing
   * FTS5 degrades rather than fails (D30).
   */
  createSearcher(): SqliteSearcher | null {
    return this.indexing
      ? new SqliteSearcher(this.database, this, this.tokenizer, this.reads)
      : null;
  }

  /** Marks the index filled; called once a rebuild has run. */
  searchRebuilt(): void {
    this.rebuildDue = false;
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
    this.scopes.renameProject(id, name);
  }

  async deleteProject(name: string): Promise<void> {
    this.scopes.deleteProject(name);
  }

  async createEnvironment(
    project: string,
    env: string,
    id?: string
  ): Promise<EnvironmentRecord> {
    return this.scopes.createEnvironment(project, env, id);
  }

  async listEnvironments(project: string): Promise<EnvironmentRecord[]> {
    return this.scopes.listEnvironments(project);
  }

  async findEnvironment(project: string, env: string): Promise<EnvironmentRecord | null> {
    return this.scopes.findEnvironment(project, env);
  }

  async renameEnvironment(id: string, name: string): Promise<void> {
    this.scopes.renameEnvironment(id, name);
  }

  async deleteEnvironment(project: string, env: string): Promise<void> {
    this.scopes.deleteEnvironment(project, env);
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
    this.collections.rename(id, name);
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
    this.collections.delete(scope, collection);
  }

  async put(entry: Entry, derived: DerivedIndex): Promise<void> {
    this.entries.put(entry, derived);
  }

  async get(scope: Scope, collection: string, id: string): Promise<Entry> {
    return this.entries.get(scope, collection, id);
  }

  async delete(scope: Scope, collection: string, id: string): Promise<void> {
    this.entries.delete(scope, collection, id);
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

  /**
   * Installs the index, or — when indexing is off — invalidates the stamp so a
   * later enabled start rebuilds rather than trusting rows that went stale
   * while nothing maintained them.
   *
   * Nothing is dropped: opening a store must not destroy the index a
   * differently-configured process is keeping on the same data dir.
   */
  private static prepareIndex(
    database: SqliteConnection,
    search: SearchIndexOptions,
    indexing: boolean
  ): boolean {
    if (!indexing) {
      SearchIndex.disable(database);
      return false;
    }
    return (
      SearchIndex.install(database, search.tokenizer) || SearchIndex.isEmptyWithContent(database)
    );
  }
}
