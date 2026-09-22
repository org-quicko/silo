import type { CollectionRecord } from "../../domain/collection-record";
import type { Entry } from "../../domain/entry";
import type { EnvironmentRecord } from "../../domain/environment-record";
import type { ProjectRecord } from "../../domain/project-record";
import { EntryUtils } from "../../domain/entry-utils";
import { Scope } from "../../domain/scope";
import { ConflictError } from "../../errors/conflict-error";
import { MediaRef } from "@silo/shared/media-ref";
import { MediaCatalog } from "../../media/media-catalog";
import { MediaRefs } from "../../media/media-refs";
import { SearchText } from "../../search/search-text";
import { TrashKinds } from "../../trash/trash-kind";
import type { TrashedAsset, TrashedEntry, TrashItem } from "../../trash/trash-item";
import type { ServiceContext } from "../support/service-context";
import { TrashLocator } from "./trash-locator";
import type { TrashRestoreResult } from "./trash-restore-result";
import { TrashStore } from "./trash-store";

/**
 * Replays one receipt's parked records back into the live tables (D91).
 *
 * Kind by kind in `TrashKinds.RestoreOrder`, so a container is written before
 * anything it holds. Callers hold the write lock.
 */
export class TrashRestorer {
  private readonly context: ServiceContext;
  private readonly store: TrashStore;

  constructor(context: ServiceContext, store: TrashStore) {
    this.context = context;
    this.store = store;
  }

  /** `rename` applies to the subject record only; descendants keep their
   *  names, which were never in collision. */
  async replay(
    trashId: string,
    subjectId: string,
    rename: string | undefined,
    into: TrashRestoreResult
  ): Promise<void> {
    const locator = new TrashLocator(this.context.store);
    const referenced = new Set<string>();

    for (const kind of TrashKinds.RestoreOrder) {
      let offset = 0;
      while (true) {
        const page = await this.store.listItems(trashId, {
          limit: TrashStore.PageSize,
          offset,
        });
        if (page.items.length === 0) break;
        for (const entry of page.items) {
          const item = entry.data as TrashItem;
          if (item.kind !== kind) continue;
          await this.write(item, subjectId, rename, locator, referenced, into);
        }
        offset += page.items.length;
        if (offset >= page.total) break;
      }
    }

    await this.reportBrokenReferences(referenced, into);
  }

  private async write(
    item: TrashItem,
    subjectId: string,
    rename: string | undefined,
    locator: TrashLocator,
    referenced: Set<string>,
    into: TrashRestoreResult
  ): Promise<void> {
    switch (item.kind) {
      case "project":
        return this.writeProject(item.record as ProjectRecord, subjectId, rename, locator, into);
      case "environment":
        return this.writeEnvironment(
          item.record as EnvironmentRecord,
          subjectId,
          rename,
          locator,
          into
        );
      case "collection":
        return this.writeCollection(
          item.record as CollectionRecord,
          subjectId,
          rename,
          locator,
          into
        );
      case "entry":
        return this.writeEntry(item.record as TrashedEntry, locator, referenced, into);
      case "media":
        return this.writeAsset(item.record as TrashedAsset, into);
      case "media_folder":
        return this.writeFolder(item.record as { path: string });
    }
  }

  private async writeProject(
    record: ProjectRecord,
    subjectId: string,
    rename: string | undefined,
    locator: TrashLocator,
    into: TrashRestoreResult
  ): Promise<void> {
    const name = record.id === subjectId && rename ? rename : record.name;
    const taken = await this.context.store.findProject(name);
    if (taken) TrashRestorer.refuse("project", name, taken.id, record.id);
    await this.context.store.createProject(name, record.id);
    locator.remember("project", record.id, name);
    into.projects += 1;
    if (record.id === subjectId && rename) into.renamed_to = name;
  }

  private async writeEnvironment(
    record: EnvironmentRecord,
    subjectId: string,
    rename: string | undefined,
    locator: TrashLocator,
    into: TrashRestoreResult
  ): Promise<void> {
    const project = await locator.projectName(record.project_id);
    if (!project) throw new ConflictError(`project for environment "${record.name}" no longer exists`);
    const name = record.id === subjectId && rename ? rename : record.name;
    const taken = await this.context.store.findEnvironment(project, name);
    if (taken) TrashRestorer.refuse("environment", name, taken.id, record.id);
    await this.context.store.createEnvironment(project, name, record.id);
    locator.remember("environment", record.id, name);
    into.environments += 1;
    if (record.id === subjectId && rename) into.renamed_to = name;
  }

  private async writeCollection(
    record: CollectionRecord,
    subjectId: string,
    rename: string | undefined,
    locator: TrashLocator,
    into: TrashRestoreResult
  ): Promise<void> {
    const scope = await locator.scopeOf(record.project_id, record.env_id);
    if (!scope) throw new ConflictError(`scope for collection "${record.name}" no longer exists`);
    const name = record.id === subjectId && rename ? rename : record.name;
    const taken = await this.context.store.findCollection(scope, name);
    if (taken) TrashRestorer.refuse("collection", name, taken.id, record.id);
    await this.context.store.putSchema(scope, name, record.schema, record.id);
    locator.remember("collection", record.id, name);
    this.context.schemaRegistry.invalidate();
    into.collections += 1;
    if (record.id === subjectId && rename) into.renamed_to = name;
  }

  private async writeEntry(
    record: TrashedEntry,
    locator: TrashLocator,
    referenced: Set<string>,
    into: TrashRestoreResult
  ): Promise<void> {
    const scope = await locator.scopeOf(record.project_id, record.env_id);
    const collection = scope
      ? await locator.collectionName(record.project_id, record.env_id, record.collection_id)
      : null;
    if (!scope || !collection) {
      throw new ConflictError(`collection for entry "${record.id}" no longer exists`);
    }

    // An id clash means something was recreated under the id this entry had.
    // Overwriting it would restore one thing by destroying another.
    const clash = await this.context.store
      .get(scope, collection, record.id)
      .then(() => true)
      .catch(() => false);
    if (clash) {
      throw new ConflictError(
        `entry "${record.id}" already exists in "${collection}"; it was recreated after this was deleted`
      );
    }

    const usages = MediaRefs.extract(record.data);
    for (const reference of usages) referenced.add(reference);

    let schema: unknown;
    try {
      schema = await this.context.store.getSchema(scope, collection);
    } catch {
      schema = undefined;
    }

    const entry: Entry = {
      id: record.id,
      project: scope.project,
      env: scope.env,
      collection,
      rev: record.rev,
      seq: 0,
      created_at: new Date(record.created_at),
      updated_at: new Date(record.updated_at),
      data: record.data,
    };
    await this.context.store.put(entry, {
      usages,
      search: SearchText.extract(record.data, schema),
    });
    into.entries += 1;
  }

  private async writeAsset(record: TrashedAsset, into: TrashRestoreResult): Promise<void> {
    const { id, created_at, ...asset } = record;
    const entry: Entry = {
      id,
      project: Scope.System.project,
      env: Scope.System.env,
      collection: MediaCatalog.Collection,
      rev: 1,
      seq: 0,
      created_at: new Date(created_at),
      updated_at: EntryUtils.now(),
      data: { ...asset, state: "active" },
    };
    await this.context.store.put(entry, { usages: [], search: null });
    into.assets += 1;
  }

  private async writeFolder(record: { path: string }): Promise<void> {
    const entry: Entry = {
      id: EntryUtils.newID(),
      project: Scope.System.project,
      env: Scope.System.env,
      collection: MediaCatalog.FoldersCollection,
      rev: 1,
      seq: 0,
      created_at: EntryUtils.now(),
      updated_at: EntryUtils.now(),
      data: { path: record.path },
    };
    await this.context.store.put(entry, { usages: [], search: null });
  }

  /**
   * A live record already holds this name. Refused rather than overwritten:
   * restoring one thing by destroying another is not a restore, and the name
   * was free precisely because the trash parks rather than flags (D91).
   */
  private static refuse(kind: string, name: string, takenBy: string, restoring: string): never {
    throw new ConflictError(
      takenBy === restoring
        ? `${kind} "${name}" already exists`
        : `${kind} "${name}" was created after this was deleted; restore it under another name`
    );
  }

  /** Which of the references the restored content makes no longer resolve. */
  private async reportBrokenReferences(
    referenced: Set<string>,
    into: TrashRestoreResult
  ): Promise<void> {
    for (const token of referenced) {
      // `MediaRefs.extract` answers catalog ids and `blob:<key>` tokens; only
      // the former names a record this can look up.
      if (token.startsWith(MediaRef.BlobTokenPrefix)) continue;
      try {
        await this.context.store.get(Scope.System, MediaCatalog.Collection, token);
      } catch {
        into.broken_media_refs.push(token);
      }
    }
  }
}
