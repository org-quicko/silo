import { isDeepStrictEqual } from "node:util";
import { MediaRef } from "@silo/shared/media-ref";
import type { CollectionRecord } from "../../domain/collection-record";
import type { EnvironmentRecord } from "../../domain/environment-record";
import type { ProjectRecord } from "../../domain/project-record";
import type { Entry } from "../../domain/entry";
import { EntryUtils } from "../../domain/entry-utils";
import { Scope } from "../../domain/scope";
import { ConflictError } from "../../errors/conflict-error";
import { NotFoundError } from "../../errors/not-found-error";
import { MediaCatalog } from "../../media/media-catalog";
import { MediaRefs } from "../../media/media-refs";
import { SearchText } from "../../search/search-text";
import { TrashKinds } from "../../trash/trash-kind";
import type { TrashedAsset, TrashedEntry, TrashItem } from "../../trash/trash-item";
import { MediaCatalogStore } from "../media/media-catalog-store";
import type { ServiceContext } from "../support/service-context";
import { TrashLocator } from "./trash-locator";
import { TrashContainerRestorer } from "./trash-container-restorer";
import type { TrashRestoreResult } from "./trash-restore-result";
import { TrashStore } from "./trash-store";

/**
 * Replays one receipt's parked records back into the live tables (D113).
 *
 * Kind by kind in `TrashKinds.RestoreOrder`, so a container is written before
 * anything it holds. Callers hold the write lock.
 */
export class TrashRestorer {
  private readonly context: ServiceContext;
  private readonly store: TrashStore;
  private readonly containers: TrashContainerRestorer;

  constructor(context: ServiceContext, store: TrashStore) {
    this.context = context;
    this.store = store;
    this.containers = new TrashContainerRestorer(context);
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
          await this.write(entry, subjectId, rename, locator, referenced, into);
        }
        offset += page.items.length;
        if (offset >= page.total) break;
      }
    }

    await this.reportBrokenReferences(referenced, into);
  }

  private async write(
    parked: Entry,
    subjectId: string,
    rename: string | undefined,
    locator: TrashLocator,
    referenced: Set<string>,
    into: TrashRestoreResult
  ): Promise<void> {
    const item = parked.data as TrashItem;
    const retry = item.restore_started === true;
    const start = (name?: string) => this.store.startRestore(parked, name);
    switch (item.kind) {
      case "project":
        return this.containers.project(item.record as ProjectRecord, subjectId, rename, locator, into, retry, start);
      case "environment":
        return this.containers.environment(
          item.record as EnvironmentRecord,
          subjectId,
          rename,
          locator,
          into,
          retry,
          start
        );
      case "collection":
        return this.containers.collection(
          item.record as CollectionRecord,
          subjectId,
          rename,
          locator,
          into,
          retry,
          start
        );
      case "entry":
        return this.writeEntry(item.record as TrashedEntry, locator, referenced, into, retry, start);
      case "media":
        return this.writeAsset(item.record as TrashedAsset, into, retry, start);
      case "media_folder":
        return this.writeFolder(item.record as { path: string }, start);
    }
  }

  private async writeEntry(
    record: TrashedEntry,
    locator: TrashLocator,
    referenced: Set<string>,
    into: TrashRestoreResult,
    retry: boolean,
    start: () => Promise<void>
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
    const current = await this.context.store
      .get(scope, collection, record.id)
      .catch((caught) => {
        if (caught instanceof NotFoundError) return null;
        throw caught;
      });
    if (current && (!retry || current.rev !== record.rev ||
      current.created_at.toISOString() !== new Date(record.created_at).toISOString() ||
      current.updated_at.toISOString() !== new Date(record.updated_at).toISOString() ||
      !isDeepStrictEqual(current.data, record.data))) {
      throw new ConflictError(
        `entry "${record.id}" already exists in "${collection}"; it was recreated after this was deleted`
      );
    }

    const usages = MediaRefs.extract(record.data);
    for (const reference of usages) referenced.add(reference);
    if (current) {
      into.entries += 1;
      return;
    }

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
    await start();
    await this.context.store.put(entry, {
      usages,
      search: SearchText.extract(record.data, schema),
    });
    into.entries += 1;
  }

  private async writeAsset(record: TrashedAsset, into: TrashRestoreResult, retry: boolean, start: () => Promise<void>): Promise<void> {
    const { id, created_at, ...asset } = record;
    const current = await new MediaCatalogStore(this.context).findAsset(id);
    if (current) {
      if (!retry || current.rev !== 1 || !isDeepStrictEqual(current.data, { ...asset, state: "active" }) ||
        current.created_at.toISOString() !== new Date(created_at).toISOString()) {
        throw new ConflictError(`media asset "${id}" already exists; it changed since this was deleted`);
      }
      into.assets += 1;
      return;
    }
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
    await start();
    await this.context.store.put(entry, { usages: [], search: null });
    into.assets += 1;
  }

  /** A folder someone has made again since is joined, not refused: two
   *  records for one path would be a duplicate, not a collision. */
  private async writeFolder(record: { path: string }, start: () => Promise<void>): Promise<void> {
    const catalog = new MediaCatalogStore(this.context);
    if (await catalog.folder(record.path)) return;
    await start();
    await catalog.putFolder(record.path);
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
