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
import { FsCollectionStore } from "./fs-collection-store";
import { FsEntryStore } from "./fs-entry-store";
import { FsLayout } from "./fs-layout";
import { FsManifestStore } from "./fs-manifest-store";
import { FsMediaUsageScanner } from "./fs-media-usage-scanner";
import { FsScopeStore } from "./fs-scope-store";
import { FsSystemSeed } from "./fs-system-seed";

/**
 * Plain JSON files on disk, where the layout **is** the export format (D5) —
 * so an fs-backed instance is a live export, and `cp` or `rsync` is backup and
 * replication.
 *
 * This class is the `Storage` port; the collaborators below hold the behaviour.
 * It keeps no index of any kind — media usages and search text are derived by
 * scanning at query time, because an on-disk index would break the frozen
 * layout and an in-memory one would go stale under an `rsync`. That is also why
 * there is no name-to-id cache here where SQLite has one: identity is read from
 * the markers on every operation (D51).
 */
export class FsStore implements Storage {
  private readonly manifest: FsManifestStore;
  private readonly scopes: FsScopeStore;
  private readonly collections: FsCollectionStore;
  private readonly entries: FsEntryStore;
  private readonly mediaUsages: FsMediaUsageScanner;

  private constructor(layout: FsLayout, manifest: FsManifestStore) {
    this.manifest = manifest;
    this.scopes = new FsScopeStore(layout);
    this.collections = new FsCollectionStore(layout, this.scopes);
    this.entries = new FsEntryStore(layout, manifest);
    this.mediaUsages = new FsMediaUsageScanner(layout);
  }

  static async open(dir: string): Promise<FsStore> {
    const layout = new FsLayout(dir);
    const store = new FsStore(layout, await FsManifestStore.open(layout));
    await FsSystemSeed.apply(layout);
    // Any collection rename a crash left half-applied, finished before anything
    // reads the tree. Counted, never thrown.
    await store.collections.resumePending();
    return store;
  }

  async close(): Promise<void> {
    // Nothing to release: every operation opens and closes its own handles.
  }

  async meta(): Promise<Meta> {
    return this.manifest.meta;
  }

  markDefaultsInitialized(): Promise<void> {
    return this.manifest.markDefaultsInitialized();
  }

  createProject(name: string, id?: string): Promise<ProjectRecord> {
    return this.scopes.createProject(name, id);
  }

  listProjects(): Promise<ProjectRecord[]> {
    return this.scopes.listProjects();
  }

  findProject(name: string): Promise<ProjectRecord | null> {
    return this.scopes.findProject(name);
  }

  renameProject(id: string, name: string): Promise<void> {
    return this.scopes.renameProject(id, name);
  }

  deleteProject(name: string): Promise<void> {
    return this.scopes.deleteProject(name);
  }

  createEnvironment(project: string, env: string, id?: string): Promise<EnvironmentRecord> {
    return this.scopes.createEnvironment(project, env, id);
  }

  listEnvironments(project: string): Promise<EnvironmentRecord[]> {
    return this.scopes.listEnvironments(project);
  }

  findEnvironment(project: string, env: string): Promise<EnvironmentRecord | null> {
    return this.scopes.findEnvironment(project, env);
  }

  renameEnvironment(id: string, name: string): Promise<void> {
    return this.scopes.renameEnvironment(id, name);
  }

  deleteEnvironment(project: string, env: string): Promise<void> {
    return this.scopes.deleteEnvironment(project, env);
  }

  listScopes(): Promise<Scope[]> {
    return this.scopes.listScopes();
  }

  listCollections(scope: Scope): Promise<CollectionRecord[]> {
    return this.collections.list(scope);
  }

  findCollection(scope: Scope, collection: string): Promise<CollectionRecord | null> {
    return this.collections.find(scope, collection);
  }

  renameCollection(id: string, name: string): Promise<void> {
    return this.collections.rename(id, name);
  }

  putSchema(
    scope: Scope,
    collection: string,
    schema: any,
    id?: string
  ): Promise<CollectionRecord> {
    return this.collections.put(scope, collection, schema, id);
  }

  getSchema(scope: Scope, collection: string): Promise<any> {
    return this.collections.get(scope, collection);
  }

  deleteSchema(scope: Scope, collection: string): Promise<void> {
    return this.collections.delete(scope, collection);
  }

  /** `derived` is deliberately ignored — see the class note. */
  put(entry: Entry, derived: DerivedIndex): Promise<void> {
    void derived;
    return this.entries.put(entry);
  }

  get(scope: Scope, collection: string, id: string): Promise<Entry> {
    return this.entries.get(scope, collection, id);
  }

  delete(scope: Scope, collection: string, id: string): Promise<void> {
    return this.entries.delete(scope, collection, id);
  }

  list(scope: Scope, collection: string, query: Query): Promise<{ items: Entry[]; total: number }> {
    return this.entries.list(scope, collection, query);
  }

  listEntryCollections(scope: Scope): Promise<string[]> {
    return this.entries.listCollections(scope);
  }

  listMediaUsages(
    mediaIds: string[],
    page: { limit?: number; offset?: number } = {}
  ): Promise<{ items: MediaUsage[]; total: number }> {
    return this.mediaUsages.list(mediaIds, page);
  }

  countMediaUsages(mediaIds: string[]): Promise<Map<string, number>> {
    return this.mediaUsages.count(mediaIds);
  }
}
