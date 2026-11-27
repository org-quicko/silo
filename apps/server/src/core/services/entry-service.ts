import { MergePatch } from "@silo/shared/merge-patch";
import { ReservedFieldNames } from "@silo/shared/reserved-field-names";
import { ValidationError } from "@silo/shared/validation-error";
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
import type { DeleteOptions } from "../trash/delete-options";
import { DeleteOptionsUtils } from "../trash/delete-options";
import type { MediaService } from "./media/media-service";
import type { TrashService } from "./trash/trash-service";
import { DerivedIndexBuilder } from "./support/derived-index-builder";
import { EntryEvents } from "./support/entry-events";
import type { ServiceContext } from "./support/service-context";

/** Entry CRUD: the hook dispatch points, media reference checking, schema
 *  validation, and the optimistic-concurrency `rev` check. */
export class EntryService {
  private readonly context: ServiceContext;
  private readonly media: MediaService;
  private readonly trash: TrashService;
  private readonly derivedIndex: DerivedIndexBuilder;

  constructor(context: ServiceContext, media: MediaService, trash: TrashService) {
    this.context = context;
    this.media = media;
    this.trash = trash;
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

    const { canonical, usages, schemaSnapshot, preparedGeneration } = await this.prepare(
      scope,
      collection,
      data
    );

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
      await this.revalidateIfSchemaChanged(
        scope,
        collection,
        canonical,
        schemaSnapshot,
        preparedGeneration
      );
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
    return this.commitUpdate(scope, collection, id, data, expectedRev, writeContext);
  }

  /**
   * Partial update via [RFC 7396](https://www.rfc-editor.org/rfc/rfc7396) JSON
   * Merge Patch applied over the stored raw entry (`current.data`), preserving
   * untouched `{{NAME}}` variable templates and valid `silo://media/<id>`
   * references before running the standard update pipeline.
   */
  async patch(
    scope: Scope,
    collection: string,
    id: string,
    patch: unknown,
    expectedRev: number,
    writeContext: WriteContext = WriteContexts.Api
  ): Promise<Entry> {
    await this.requireUserCollection(scope, collection);
    if (!EntryService.isPlainObject(patch)) {
      throw new ValidationError("entry patch must be a JSON object");
    }
    ReservedFieldNames.assertNonePresent(patch);

    // Read the stored raw entry and check rev upfront before running hooks;
    // the authoritative rev check still runs under the write lock below.
    const preview = await this.context.store.get(scope, collection, id);
    EntryService.assertRev(preview.rev, expectedRev);

    const target = EntryService.isPlainObject(preview.data) ? preview.data : {};
    const merged = MergePatch.applyToObject(target, patch);
    return this.commitUpdate(scope, collection, id, merged, expectedRev, writeContext, preview);
  }

  private async commitUpdate(
    scope: Scope,
    collection: string,
    id: string,
    candidateData: unknown,
    expectedRev: number,
    writeContext: WriteContext,
    previewEntry?: Entry
  ): Promise<Entry> {
    const data = await this.context.hooks.beforeValidate(
      EntryEvents.validating("update", writeContext, scope, collection, candidateData, id)
    );

    const { canonical, usages, schemaSnapshot, preparedGeneration } = await this.prepare(
      scope,
      collection,
      data
    );

    // Built before the veto hook so the hook sees the rev it would produce, and
    // dispatched outside the write lock for the reason `create` gives. The
    // authoritative rev check stays under the lock below, so a hook cannot make
    // a lost update possible.
    const preview = previewEntry ?? (await this.context.store.get(scope, collection, id));
    await this.context.hooks.beforeWrite(
      EntryEvents.write("update", writeContext, {
        ...preview,
        rev: preview.rev + 1,
        data: canonical,
      })
    );

    const written = await this.context.withWriteLock(async () => {
      const current = await this.context.store.get(scope, collection, id);
      EntryService.assertRev(current.rev, expectedRev);
      // A merge patch computes `canonical` against `previewEntry.data` before
      // acquiring the lock, so a same-rev overwrite (such as an import that
      // preserved `rev` while advancing `seq`) must also conflict.
      if (previewEntry && (current.rev !== previewEntry.rev || current.seq !== previewEntry.seq)) {
        throw new ConflictError(`entry "${id}" was modified concurrently; reread and try again`);
      }

      await this.revalidateIfSchemaChanged(
        scope,
        collection,
        canonical,
        schemaSnapshot,
        preparedGeneration
      );
      await this.media.referenceGuard.assertReferencable(usages);

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

  /**
   * `options.permanent` skips the trash (D113). The hooks fire either way: from
   * a plugin's side the entry has left the live instance, and a mirrored index
   * should drop it whether or not it is recoverable.
   */
  async delete(
    scope: Scope,
    collection: string,
    id: string,
    expectedRev: number,
    writeContext: WriteContext = WriteContexts.Api,
    options: DeleteOptions = {}
  ): Promise<string | null> {
    EntryService.refuseSystemCollection(scope, collection);

    // Read before the lock purely to give the veto hook the entry it is being
    // asked about — a hook that can only see an id cannot decide anything. The
    // authoritative read and rev check happen under the lock.
    const doomed = await this.context.store.get(scope, collection, id);
    await this.context.hooks.beforeDelete(EntryEvents.deleting(writeContext, doomed));

    const { rev, receipt } = await this.context.withWriteLock(async () => {
      const current = await this.context.store.get(scope, collection, id);
      EntryService.assertRev(current.rev, expectedRev);
      let receiptId: string | null = null;
      if (this.trash.enabled && !DeleteOptionsUtils.isPermanent(options)) {
        receiptId = await this.trash.capture.entry(
          scope,
          collection,
          current,
          DeleteOptionsUtils.actorOf(options),
          this.trash.expiryStamp()
        );
      }
      await this.context.store.delete(scope, collection, id);
      return { rev: current.rev, receipt: receiptId };
    });

    await this.context.hooks.afterDelete(
      EntryEvents.deleted(writeContext, scope, collection, id, rev)
    );
    return receipt;
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
  ): Promise<{
    canonical: any;
    usages: string[];
    schemaSnapshot: string;
    preparedGeneration: number;
  }> {
    const canonical = MediaRefs.canonicalize(data);
    while (true) {
      const generationBefore = this.context.schemaRegistry.currentGeneration();
      const schemaSnapshot = await this.captureSchemaSnapshot(scope, collection);
      try {
        await this.context.schemaRegistry.validateEntry(scope, collection, canonical);
      } catch (caught) {
        if (this.context.schemaRegistry.currentGeneration() === generationBefore) {
          throw caught;
        }
        continue;
      }
      const generationAfter = this.context.schemaRegistry.currentGeneration();
      if (generationBefore === generationAfter) {
        return {
          canonical,
          usages: MediaRefs.extract(canonical),
          schemaSnapshot,
          preparedGeneration: generationAfter,
        };
      }
    }
  }

  private async captureSchemaSnapshot(scope: Scope, collection: string): Promise<string> {
    const record = await this.context.store.findCollection(scope, collection);
    if (!record) {
      throw new NotFoundError(`collection "${scope.key()}/${collection}" not found`);
    }
    return JSON.stringify(record.schema);
  }

  private async revalidateIfSchemaChanged(
    scope: Scope,
    collection: string,
    canonical: unknown,
    preparedSchemaSnapshot: string,
    preparedGeneration: number
  ): Promise<void> {
    const latest = await this.context.store.findCollection(scope, collection);
    if (!latest) {
      throw new NotFoundError(`collection "${scope.key()}/${collection}" not found`);
    }
    const schemaDiffers = JSON.stringify(latest.schema) !== preparedSchemaSnapshot;
    const generationDiffers =
      this.context.schemaRegistry.currentGeneration() !== preparedGeneration;
    if (!schemaDiffers && !generationDiffers) {
      return;
    }
    if (schemaDiffers) {
      // Clear cached validators in case the store schema changed directly without
      // going through `SchemaRegistry.invalidate()`.
      this.context.schemaRegistry.invalidate();
    }
    await this.context.schemaRegistry.validateEntry(scope, collection, canonical);
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

  private static isPlainObject(value: unknown): value is Record<string, unknown> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }
}
