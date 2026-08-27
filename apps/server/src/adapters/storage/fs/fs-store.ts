import type { Entry } from "../../../core/domain/entry";
import type { Meta } from "../../../core/domain/meta";
import type { Scope } from "../../../core/domain/scope";
import type { MediaUsage } from "../../../core/media/media-usage";
import type { DerivedIndex } from "../../../core/ports/derived-index";
import type { Storage } from "../../../core/ports/storage";
import type { Query } from "../../../core/query/query";
import { FsEntryStore } from "./fs-entry-store";
import { FsLayout } from "./fs-layout";
import { FsManifestStore } from "./fs-manifest-store";
import { FsMediaUsageScanner } from "./fs-media-usage-scanner";
import { FsSchemaStore } from "./fs-schema-store";
import { FsScopeStore } from "./fs-scope-store";

/**
 * Plain JSON files on disk, where the layout **is** the export format (D5) —
 * so an fs-backed instance is a live export, and `cp` or `rsync` is backup and
 * replication.
 *
 * This class is the `Storage` port; the five collaborators below hold the
 * behaviour. It keeps no index of any kind: media usages and search text are
 * derived by scanning at query time, because an on-disk index would break the
 * frozen layout and an in-memory one would go stale under an `rsync`.
 */
export class FsStore implements Storage {
  private readonly manifest: FsManifestStore;
  private readonly scopes: FsScopeStore;
  private readonly schemas: FsSchemaStore;
  private readonly entries: FsEntryStore;
  private readonly mediaUsages: FsMediaUsageScanner;

  private constructor(layout: FsLayout, manifest: FsManifestStore) {
    this.manifest = manifest;
    this.scopes = new FsScopeStore(layout);
    this.schemas = new FsSchemaStore(layout);
    this.entries = new FsEntryStore(layout, manifest);
    this.mediaUsages = new FsMediaUsageScanner(layout);
  }

  static async open(dir: string): Promise<FsStore> {
    const layout = new FsLayout(dir);
    return new FsStore(layout, await FsManifestStore.open(layout));
  }

  async close(): Promise<void> {
    // Nothing to release: every operation opens and closes its own handles.
  }

  async meta(): Promise<Meta> {
    return this.manifest.meta;
  }

  createProject(project: string): Promise<void> {
    return this.scopes.createProject(project);
  }

  listProjects(): Promise<string[]> {
    return this.scopes.listProjects();
  }

  deleteProject(project: string): Promise<void> {
    return this.scopes.deleteProject(project);
  }

  createEnvironment(project: string, env: string): Promise<void> {
    return this.scopes.createEnvironment(project, env);
  }

  listEnvironments(project: string): Promise<string[]> {
    return this.scopes.listEnvironments(project);
  }

  deleteEnvironment(project: string, env: string): Promise<void> {
    return this.scopes.deleteEnvironment(project, env);
  }

  listScopes(): Promise<Scope[]> {
    return this.scopes.listScopes();
  }

  putSchema(scope: Scope, collection: string, schema: any): Promise<void> {
    return this.schemas.put(scope, collection, schema);
  }

  getSchema(scope: Scope, collection: string): Promise<any> {
    return this.schemas.get(scope, collection);
  }

  listSchemas(scope: Scope): Promise<Map<string, any>> {
    return this.schemas.list(scope);
  }

  deleteSchema(scope: Scope, collection: string): Promise<void> {
    return this.schemas.delete(scope, collection);
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
