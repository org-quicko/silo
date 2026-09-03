import { Claims } from "@silo/shared/claims";
import { SchemaAccess } from "@silo/shared/schema-access";
import { SearchFields } from "@silo/shared/search-fields";
import { ValidationError } from "@silo/shared/validation-error";
import type { Collection } from "../domain/collection";
import type { CollectionSummary } from "../domain/collection-summary";
import { EntryUtils } from "../domain/entry-utils";
import type { Scope } from "../domain/scope";
import { ConflictError } from "../errors/conflict-error";
import { NotFoundError } from "../errors/not-found-error";
import type { WriteContext } from "../hooks/write-context";
import { WriteContexts } from "../hooks/write-contexts";
import { CollectionSchemas } from "../schema/collection-schemas";
import { SchemaBundler } from "../schema/schema-bundler";
import { SchemaRefRewrite } from "../schema/schema-ref-rewrite";
import { CollectionEvents } from "./support/collection-events";
import { CollectionEraser } from "./support/collection-eraser";
import { SchemaRegistry } from "./support/schema-registry";
import type { ServiceContext } from "./support/service-context";

/** Collections and their JSON Schemas, within one scope. */
export class CollectionService {
  private readonly context: ServiceContext;

  constructor(context: ServiceContext) {
    this.context = context;
  }

  /**
   * Every user collection in `scope` as the listing answers it, sorted by name:
   * name, entry count, access and timestamps, and **no schema** (D54).
   *
   * Two reads for the whole scope — the records, and one grouped count — rather
   * than the one-`limit: 1`-list-per-collection the callers of `list` used to
   * do to learn the same numbers.
   */
  async summaries(scope: Scope): Promise<CollectionSummary[]> {
    const [records, counts] = await Promise.all([
      this.context.store.listCollections(scope),
      this.context.store.countEntries(scope),
    ]);

    const summaries: CollectionSummary[] = [];
    for (const record of records) {
      if (EntryUtils.isSystemCollection(record.name)) continue;
      summaries.push({
        id: record.id,
        name: record.name,
        entries: counts.get(record.name) ?? 0,
        requires_auth: SchemaAccess.requiresAuth(record.schema),
        created_at: record.created_at.toISOString(),
        updated_at: record.updated_at.toISOString(),
      });
    }
    summaries.sort((left, right) => left.name.localeCompare(right.name));
    return summaries;
  }

  /** Every user collection in `scope` **with** its schema, sorted by name.
   *  What the bulk schema route answers, and what every in-process caller that
   *  needs to read schemas asks for. System collections are reserved and never
   *  listed (D12/D18). */
  async list(scope: Scope): Promise<Collection[]> {
    const collections: Collection[] = [];
    for (const record of await this.context.store.listCollections(scope)) {
      if (EntryUtils.isSystemCollection(record.name)) continue;
      collections.push({ id: record.id, name: record.name, schema: record.schema });
    }
    collections.sort((left, right) => left.name.localeCompare(right.name));
    return collections;
  }

  async get(scope: Scope, name: string): Promise<Collection> {
    CollectionService.refuseSystemCollection(scope, name);

    const record = await this.context.store.findCollection(scope, name);
    if (!record) {
      throw new NotFoundError(`collection "${scope.key()}/${name}" not found`);
    }
    return { id: record.id, name: record.name, schema: record.schema };
  }

  /**
   * One collection whose `silo://` refs are bundled into `$defs` **as of now**.
   *
   * `putSchema` already bundles, so a stored schema is self-contained as of its
   * own last save — which is not the same thing. A collection referenced before
   * it existed was skipped, and one whose shape changed since is embedded as the
   * copy it was then. Re-bundling on the way out is what makes the answer a
   * document a client can render on its own, which is the whole point of
   * bundling (D54): the alternative is every client fetching every schema in the
   * scope on the chance that one of them is referenced.
   *
   * Deliberately not on `get`, which the entry routes call on every request to
   * check access, and which needs the record and nothing else.
   */
  async getBundled(scope: Scope, name: string): Promise<Collection> {
    const collection = await this.get(scope, name);
    return {
      ...collection,
      schema: await SchemaBundler.bundle(
        scope,
        collection.schema,
        this.context.store,
        this.context.schemaRegistry.remoteLoader,
        this.context.schemaRegistry.allowRemoteRefs
      ),
    };
  }

  /** Creates or replaces a collection's schema, bundling its `$ref`s first. */
  async putSchema(scope: Scope, name: string, schema: any): Promise<Collection> {
    if (!Claims.isCollectionName(name)) {
      throw new ValidationError(
        `invalid collection name "${name}": want lowercase letter first, then [a-z0-9_-], max 64 chars`
      );
    }
    // Checked on save, so a mistyped search path is a 400 the author sees now
    // rather than a field that quietly stops being searchable (D30).
    SearchFields.validate(schema);

    const bundledSchema = await SchemaBundler.bundle(
      scope,
      schema,
      this.context.store,
      this.context.schemaRegistry.remoteLoader,
      this.context.schemaRegistry.allowRemoteRefs
    );
    await this.context.schemaRegistry.checkSchemaDoc(scope, name, bundledSchema);

    return this.context.withWriteLock(async () => {
      const record = await this.context.store.putSchema(scope, name, bundledSchema);
      this.context.schemaRegistry.invalidate();
      return { id: record.id, name: record.name, schema: record.schema };
    });
  }

  /**
   * Every collection whose schema references `name`, the renamed one included
   * (D51) — what a rename has to rewrite, and what the route checks
   * `collections:schema:update` against before it starts.
   */
  async referrers(scope: Scope, name: string): Promise<string[]> {
    return this.findSchemaReferrers(scope, name, true);
  }

  /**
   * Renames a collection, and repoints every `$ref` to it.
   *
   * `$ref`s still address collections **by name**, so a rename is not the pure
   * record update the project and environment ones are: every referring schema
   * has to be rewritten, and its bundled `$defs` — which `SchemaBundler` keys by
   * collection name — rebuilt rather than patched.
   *
   * The order matters. The substitutions are computed first, so a malformed
   * result fails before anything is written; the record is renamed next, because
   * `SchemaBundler` resolves `silo://collections/<to>` against the store and
   * would find nothing until it is; then each schema is bundled, validated and
   * written. All inside the write lock, so nothing observes the moment where the
   * schemas still name the old collection.
   */
  async rename(scope: Scope, id: string, from: string, to: string): Promise<void> {
    CollectionService.refuseSystemCollection(scope, from);
    if (!Claims.isCollectionName(to)) {
      throw new ValidationError(
        `invalid collection name "${to}": want lowercase letter first, then [a-z0-9_-], max 64 chars`
      );
    }

    await this.context.withWriteLock(async () => {
      const referrers = await this.findSchemaReferrers(scope, from, true);
      const pending = new Map<string, any>();
      for (const referrer of referrers) {
        const current = await this.context.store.getSchema(scope, referrer);
        pending.set(referrer, SchemaRefRewrite.apply(current, from, to));
      }

      await this.context.store.renameCollection(id, to);
      this.context.schemaRegistry.invalidate();

      for (const [referrer, schema] of pending) {
        // The renamed collection's own schema now lives under the new name.
        const target = referrer === from ? to : referrer;
        const bundled = await SchemaBundler.bundle(
          scope,
          schema,
          this.context.store,
          this.context.schemaRegistry.remoteLoader,
          this.context.schemaRegistry.allowRemoteRefs
        );
        await this.context.schemaRegistry.checkSchemaDoc(scope, target, bundled);
        await this.context.store.putSchema(scope, target, bundled);
      }
      this.context.schemaRegistry.invalidate();
    });
  }

  /**
   * `writeContext` so a plugin's own collection delete cannot be delivered back
   * to it (D33). The hook fires **after** the lock is released, which is why the
   * count is carried out of the critical section rather than dispatched in it.
   */
  async delete(
    scope: Scope,
    name: string,
    force: boolean,
    writeContext: WriteContext = WriteContexts.Api
  ): Promise<void> {
    CollectionService.refuseSystemCollection(scope, name);

    const erased = await this.context.withWriteLock(async () => {
      // Throws if there is no such collection.
      await this.context.store.getSchema(scope, name);

      const { total } = await this.context.store.list(scope, name, { limit: 1, offset: 0 });
      if (total > 0 && !force) {
        throw new ConflictError(
          `collection "${name}" has ${total} entries; delete them or pass force`
        );
      }

      if (!force) await this.refuseWhileReferenced(scope, name);

      const count = await CollectionEraser.erase(this.context.store, scope, name);
      this.context.schemaRegistry.invalidate();
      return count;
    });

    await this.context.hooks.afterCollectionDelete(
      CollectionEvents.deleted(writeContext, scope, name, erased, "collection")
    );
  }

  /**
   * Deleting a collection another schema `$ref`s would break every write to
   * the referencing collections. Only same-scope referrers are considered —
   * cross-scope `$ref`s are not supported.
   */
  private async refuseWhileReferenced(scope: Scope, name: string): Promise<void> {
    const referrers = await this.findSchemaReferrers(scope, name);
    if (referrers.length === 0) return;

    const named = referrers.map((referrer) => `"${referrer}"`).join(", ");
    throw new ConflictError(
      `collection "${name}" is referenced by schema${referrers.length === 1 ? "" : "s"} ${named}; remove the $ref or pass force`
    );
  }

  /**
   * Collections in `scope` whose schema `$ref`s `silo://collections/<name>`,
   * with or without a fragment.
   *
   * `includeSelf` because the two callers want different sets. A **delete**
   * asks who else would break, so the collection going away is not a referrer.
   * A **rename** has to rewrite every reference to the old name, and a schema
   * that `$ref`s itself holds one of them (D51).
   */
  private async findSchemaReferrers(
    scope: Scope,
    name: string,
    includeSelf = false
  ): Promise<string[]> {
    const url = SchemaRegistry.schemaUrl(name);
    const schemas = CollectionSchemas.map(await this.context.store.listCollections(scope));
    const referrers: string[] = [];
    for (const [other, schema] of schemas.entries()) {
      if (other === name && !includeSelf) continue;
      if (CollectionService.schemaRefsUrl(schema, url)) referrers.push(other);
    }
    return referrers.sort();
  }

  private static schemaRefsUrl(node: any, url: string): boolean {
    if (Array.isArray(node)) {
      return node.some((child) => CollectionService.schemaRefsUrl(child, url));
    }
    if (!node || typeof node !== "object") return false;

    const ref = node.$ref;
    if (typeof ref === "string" && (ref === url || ref.startsWith(url + "#"))) return true;
    return Object.values(node).some((child) => CollectionService.schemaRefsUrl(child, url));
  }

  /** System collections are silo's own and are not addressable as collections. */
  private static refuseSystemCollection(scope: Scope, name: string): void {
    if (EntryUtils.isSystemCollection(name)) {
      throw new NotFoundError(`collection "${scope.key()}/${name}" not found`);
    }
  }
}
