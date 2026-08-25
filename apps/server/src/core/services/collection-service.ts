import { Claims } from "@silo/shared/claims";
import { SearchFields } from "@silo/shared/search-fields";
import { ValidationError } from "@silo/shared/validation-error";
import type { Collection } from "../domain/collection";
import { EntryUtils } from "../domain/entry-utils";
import type { Scope } from "../domain/scope";
import { ConflictError } from "../errors/conflict-error";
import { NotFoundError } from "../errors/not-found-error";
import { SchemaBundler } from "../schema/schema-bundler";
import { CollectionEraser } from "./support/collection-eraser";
import { SchemaRegistry } from "./support/schema-registry";
import type { ServiceContext } from "./support/service-context";

/** Collections and their JSON Schemas, within one scope. */
export class CollectionService {
  private readonly context: ServiceContext;

  constructor(context: ServiceContext) {
    this.context = context;
  }

  /** Every user collection in `scope`, sorted by name. System collections are
   *  reserved and never listed (D12/D18). */
  async list(scope: Scope): Promise<Collection[]> {
    const schemas = await this.context.store.listSchemas(scope);
    const collections: Collection[] = [];
    for (const [name, schema] of schemas.entries()) {
      if (EntryUtils.isSystemCollection(name)) continue;
      collections.push({ name, schema });
    }
    collections.sort((left, right) => left.name.localeCompare(right.name));
    return collections;
  }

  async get(scope: Scope, name: string): Promise<Collection> {
    CollectionService.refuseSystemCollection(scope, name);
    return { name, schema: await this.context.store.getSchema(scope, name) };
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
      await this.context.store.putSchema(scope, name, bundledSchema);
      this.context.schemaRegistry.invalidate();
      return { name, schema: bundledSchema };
    });
  }

  async delete(scope: Scope, name: string, force: boolean): Promise<void> {
    CollectionService.refuseSystemCollection(scope, name);

    await this.context.withWriteLock(async () => {
      // Throws if there is no such collection.
      await this.context.store.getSchema(scope, name);

      const { total } = await this.context.store.list(scope, name, { limit: 1, offset: 0 });
      if (total > 0 && !force) {
        throw new ConflictError(
          `collection "${name}" has ${total} entries; delete them or pass force`
        );
      }

      if (!force) await this.refuseWhileReferenced(scope, name);

      await CollectionEraser.erase(this.context.store, scope, name);
      this.context.schemaRegistry.invalidate();
    });
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

  /** Collections in `scope` whose schema `$ref`s `silo://collections/<name>`,
   *  with or without a fragment. */
  private async findSchemaReferrers(scope: Scope, name: string): Promise<string[]> {
    const url = SchemaRegistry.schemaUrl(name);
    const schemas = await this.context.store.listSchemas(scope);
    const referrers: string[] = [];
    for (const [other, schema] of schemas.entries()) {
      if (other === name) continue;
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
