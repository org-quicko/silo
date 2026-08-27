import type { Entry } from "../domain/entry";
import { EntryUtils } from "../domain/entry-utils";
import type { Scope } from "../domain/scope";
import { ConflictError } from "../errors/conflict-error";
import { NotFoundError } from "../errors/not-found-error";
import type { WriteContext } from "../hooks/write-context";
import { WriteContexts } from "../hooks/write-contexts";
import { MediaRefs } from "../media/media-refs";
import type { Query } from "../query/query";
import { QueryUtils } from "../query/query-utils";
import type { MediaService } from "./media/media-service";
import { DerivedIndexBuilder } from "./support/derived-index-builder";
import { EntryEvents } from "./support/entry-events";
import type { ServiceContext } from "./support/service-context";

/** Entry CRUD: the hook dispatch points, media reference checking, schema
 *  validation, and the optimistic-concurrency `rev` check. */
export class EntryService {
  private readonly context: ServiceContext;
  private readonly media: MediaService;
  private readonly derivedIndex: DerivedIndexBuilder;

  constructor(context: ServiceContext, media: MediaService) {
    this.context = context;
    this.media = media;
    this.derivedIndex = new DerivedIndexBuilder(context.store);
  }

  async create(
    scope: Scope,
    collection: string,
    data: any,
    writeContext: WriteContext = WriteContexts.Api
  ): Promise<Entry> {
    await this.requireUserCollection(scope, collection);

    // The one mutating hook, and it runs here for a reason: everything below
    // depends on the value being final. Placing it after validation would let a
    // plugin store what the schema never judged (D31/§13.5).
    data = await this.context.hooks.beforeValidate(
      EntryEvents.validating("create", writeContext, scope, collection, data)
    );

    const { canonical, usages } = await this.prepare(scope, collection, data);

    const now = EntryUtils.now();
    const entry: Entry = {
      id: EntryUtils.newID(),
      project: scope.project,
      env: scope.env,
      collection,
      rev: 1,
      seq: 0, // Assigned by the storage adapter.
      created_at: now,
      updated_at: now,
      data: canonical,
    };

    // Outside the write lock, not inside it: a veto hook may call out to
    // something slow, and the lock serialises every write in the instance —
    // holding it across a plugin would make one slow plugin a global stall
    // (D25, §13.9).
    await this.context.hooks.beforeWrite(EntryEvents.write("create", writeContext, entry));

    await this.context.withWriteLock(async () => {
      // Under the lock, not before it: deletion counts usages while holding the
      // same lock, so a check outside it could pass, lose the race to a delete,
      // and then write a reference to bytes that are already gone.
      await this.media.referenceGuard.assertReferencable(usages);
      await this.context.store.put(
        entry,
        await this.derivedIndex.build(scope, collection, canonical, usages)
      );
    });

    await this.context.hooks.afterWrite(EntryEvents.written("create", writeContext, entry));
    return entry;
  }

  async get(scope: Scope, collection: string, id: string): Promise<Entry> {
    EntryService.refuseSystemCollection(scope, collection);
    return this.context.store.get(scope, collection, id);
  }

  async list(
    scope: Scope,
    collection: string,
    query: Partial<Query>
  ): Promise<{ items: Entry[]; total: number; limit: number; offset: number }> {
    await this.requireUserCollection(scope, collection);

    const normalized = QueryUtils.normalizeQuery(query);
    const page = await this.context.store.list(scope, collection, normalized);
    return {
      items: page.items,
      total: page.total,
      limit: normalized.limit,
      offset: normalized.offset,
    };
  }

  async update(
    scope: Scope,
    collection: string,
    id: string,
    data: any,
    expectedRev: number,
    writeContext: WriteContext = WriteContexts.Api
  ): Promise<Entry> {
    await this.requireUserCollection(scope, collection);

    data = await this.context.hooks.beforeValidate(
      EntryEvents.validating("update", writeContext, scope, collection, data, id)
    );

    const { canonical, usages } = await this.prepare(scope, collection, data);

    // Built before the veto hook so the hook sees the rev it would produce, and
    // dispatched outside the write lock for the reason `create` gives. The
    // authoritative rev check stays under the lock below, so a hook cannot make
    // a lost update possible.
    const preview = await this.context.store.get(scope, collection, id);
    await this.context.hooks.beforeWrite(
      EntryEvents.write("update", writeContext, {
        ...preview,
        rev: preview.rev + 1,
        data: canonical,
      })
    );

    const written = await this.context.withWriteLock(async () => {
      await this.media.referenceGuard.assertReferencable(usages);

      const current = await this.context.store.get(scope, collection, id);
      EntryService.assertRev(current.rev, expectedRev);

      const next: Entry = {
        ...current,
        rev: current.rev + 1,
        updated_at: EntryUtils.now(),
        data: canonical,
      };
      await this.context.store.put(
        next,
        await this.derivedIndex.build(scope, collection, canonical, usages)
      );
      return next;
    });

    await this.context.hooks.afterWrite(EntryEvents.written("update", writeContext, written));
    return written;
  }

  async delete(
    scope: Scope,
    collection: string,
    id: string,
    expectedRev: number,
    writeContext: WriteContext = WriteContexts.Api
  ): Promise<void> {
    EntryService.refuseSystemCollection(scope, collection);

    // Read before the lock purely to give the veto hook the entry it is being
    // asked about — a hook that can only see an id cannot decide anything. The
    // authoritative read and rev check happen under the lock.
    const doomed = await this.context.store.get(scope, collection, id);
    await this.context.hooks.beforeDelete(EntryEvents.deleting(writeContext, doomed));

    const rev = await this.context.withWriteLock(async () => {
      const current = await this.context.store.get(scope, collection, id);
      EntryService.assertRev(current.rev, expectedRev);
      await this.context.store.delete(scope, collection, id);
      return current.rev;
    });

    await this.context.hooks.afterDelete(
      EntryEvents.deleted(writeContext, scope, collection, id, rev)
    );
  }

  /**
   * Canonicalises **before** validation, so the schema judges exactly the value
   * that will be stored. Reads resolve media fields into absolute URLs, so a
   * client that PUTs back what it fetched would otherwise store a URL where a
   * reference belongs — quietly turning a counted reference into an uncounted
   * string (D23).
   */
  private async prepare(
    scope: Scope,
    collection: string,
    data: any
  ): Promise<{ canonical: any; usages: string[] }> {
    const canonical = MediaRefs.canonicalize(data);
    await this.context.schemaRegistry.validateEntry(scope, collection, canonical);
    return { canonical, usages: MediaRefs.extract(canonical) };
  }

  private async requireUserCollection(scope: Scope, collection: string): Promise<void> {
    EntryService.refuseSystemCollection(scope, collection);
    await this.context.store.getSchema(scope, collection);
  }

  private static refuseSystemCollection(scope: Scope, collection: string): void {
    if (EntryUtils.isSystemCollection(collection)) {
      throw new NotFoundError(`collection "${scope.key()}/${collection}" not found`);
    }
  }

  private static assertRev(current: number, expected: number): void {
    if (current !== expected) {
      throw new ConflictError(`rev mismatch: expected ${expected}, current is ${current}`);
    }
  }
}
