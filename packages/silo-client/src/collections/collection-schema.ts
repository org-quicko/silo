import type { RequestOptions } from "../request-options.js";
import type { DeleteOptions } from "../scope/delete-options.js";
import type { ScopeReference } from "../scope/scope-reference.js";
import { ApiPath } from "../transport/api-path.js";
import type { CollectionDefinition } from "./collection-definition.js";
import type { JsonSchema } from "./json-schema.js";

/** One collection's schema, bundled on every read: `get`, `put`,
 * `delete`. Deleting the schema deletes the collection — the only path the
 * server exposes for that. */
export class CollectionSchema {
  constructor(
    private readonly scope: ScopeReference,
    private readonly name: string,
  ) {}

  async get(options: RequestOptions = {}): Promise<CollectionDefinition> {
    return this.scope.transport.json<CollectionDefinition>({
      method: "GET",
      path: ApiPath.collectionSchema(this.scope.project, this.scope.environment, this.name),
      ...options,
    });
  }

  async put(schema: JsonSchema, options: RequestOptions = {}): Promise<CollectionDefinition> {
    return this.scope.transport.json<CollectionDefinition>({
      method: "PUT",
      path: ApiPath.collectionSchema(this.scope.project, this.scope.environment, this.name),
      body: schema,
      ...options,
    });
  }

  async delete(options: DeleteOptions = {}): Promise<void> {
    await this.scope.transport.empty({
      method: "DELETE",
      path: ApiPath.collectionSchema(this.scope.project, this.scope.environment, this.name),
      query: { force: options.force || undefined },
      signal: options.signal,
      timeoutMilliseconds: options.timeoutMilliseconds,
    });
  }
}
