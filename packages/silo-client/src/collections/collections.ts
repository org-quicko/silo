import type { RequestOptions } from "../request-options.js";
import type { ScopeReference } from "../scope/scope-reference.js";
import { ApiPath } from "../transport/api-path.js";
import type { CollectionDefinition } from "./collection-definition.js";
import type { CollectionSummary } from "./collection-summary.js";
import type { JsonSchema } from "./json-schema.js";

interface CollectionSummaryPayload {
  id: string;
  name: string;
  entries: number;
  requires_auth: boolean;
  created_at: string;
  updated_at: string;
}

/** Collections within one environment: `list` answers summaries and no
 * schema, `create` answers the new collection's bundled definition. */
export class Collections {
  constructor(private readonly scope: ScopeReference) {}

  async list(options: RequestOptions = {}): Promise<CollectionSummary[]> {
    const body = await this.scope.siloContext.transport.json<{ items: CollectionSummaryPayload[] }>({
      method: "GET",
      path: ApiPath.collections(this.scope.project, this.scope.environment),
      ...options,
    });
    return body.items.map(Collections.toSummary);
  }

  /** A schema declaring a field named `id`, `rev`, `seq`, `created_at` or
   * `updated_at` is refused by the server with a `ValidationFailedError`
   * naming it, so there is nothing to warn about here (D62). */
  async create(name: string, schema: JsonSchema, options: RequestOptions = {}): Promise<CollectionDefinition> {
    return this.scope.siloContext.transport.json<CollectionDefinition>({
      method: "POST",
      path: ApiPath.collections(this.scope.project, this.scope.environment),
      body: { name, schema },
      ...options,
    });
  }

  private static toSummary(payload: CollectionSummaryPayload): CollectionSummary {
    return {
      id: payload.id,
      name: payload.name,
      entries: payload.entries,
      requiresAuth: payload.requires_auth,
      createdAt: new Date(payload.created_at),
      updatedAt: new Date(payload.updated_at),
    };
  }
}
