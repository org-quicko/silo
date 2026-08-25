import type { Storage } from "../../ports/storage";
import type { Scope } from "../../domain/scope";
import type { RemoteSchemaLoader } from "../../schema/remote-schema-loader";
import { SchemaValidator, type SchemaValidatorOptions } from "../../schema/schema-validator";

/**
 * The compiled-schema cache, and the one place that says when it is stale.
 *
 * Several services hold state derived from schema content — the compiled
 * validators here, the public-scope map in `ScopeService` — and all of it goes
 * out of date on the same events: a schema write, a collection delete, an
 * import. Listeners register once and are notified together, so no caller has
 * to remember the full list.
 */
export class SchemaRegistry {
  private readonly validator: SchemaValidator;
  private readonly invalidationListeners: Array<() => void> = [];

  constructor(store: Storage, options: SchemaValidatorOptions = {}) {
    this.validator = new SchemaValidator(store, options);
  }

  /** The canonical `$id` a collection's schema is bundled under. */
  static schemaUrl(collection: string): string {
    return SchemaValidator.schemaURL(collection);
  }

  /** Registers a cache to drop whenever schema content changes. */
  onInvalidate(listener: () => void): void {
    this.invalidationListeners.push(listener);
  }

  /** Drops every cache derived from schema content. */
  invalidate(): void {
    this.validator.invalidate();
    for (const listener of this.invalidationListeners) listener();
  }

  /** Throws a `ValidationError` if `data` does not satisfy the collection's schema. */
  async validateEntry(scope: Scope, collection: string, data: unknown): Promise<void> {
    await this.validator.validateEntry(scope, collection, data);
  }

  /** Throws if the schema document itself is not valid JSON Schema. */
  async checkSchemaDoc(scope: Scope, collection: string, schema: unknown): Promise<void> {
    await this.validator.checkSchemaDoc(scope, collection, schema);
  }

  get remoteLoader(): RemoteSchemaLoader {
    return this.validator.getRemoteLoader();
  }

  get allowRemoteRefs(): boolean {
    return this.validator.getAllowRemoteRefs();
  }
}
