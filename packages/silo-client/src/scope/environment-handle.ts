import { CollectionHandle } from "../collections/collection-handle.js";
import { Collections } from "../collections/collections.js";
import type { CollectionDefinition } from "../collections/collection-definition.js";
import type { RequestOptions } from "../request-options.js";
import { Search } from "../search/search.js";
import { SearchReach } from "../search/search-reach.js";
import type { SearchPage } from "../search/search-page.js";
import type { SearchQuery } from "../search/search-query.js";
import { ApiPath } from "../transport/api-path.js";
import { EnvironmentVariables } from "../variables/environment-variables.js";
import type { DeleteOptions } from "./delete-options.js";
import type { RenameOptions } from "./rename-options.js";
import { RenameReport, type RenamePreviewPayload } from "./rename-report.js";
import type { ScopeReference } from "./scope-reference.js";

/**
 * One environment, addressed by the name it was built with. Immutable, for
 * the reason `ProjectHandle` is.
 */
export class EnvironmentHandle {
  readonly name: string;
  readonly project: string;
  readonly collections: Collections;
  readonly variables: EnvironmentVariables;

  constructor(private readonly scope: ScopeReference) {
    this.name = scope.environment;
    this.project = scope.project;
    this.collections = new Collections(scope);
    this.variables = new EnvironmentVariables(scope);
  }

  collection<Fields = Record<string, unknown>>(name: string): CollectionHandle<Fields> {
    return new CollectionHandle<Fields>(this.scope, name);
  }

  /** Every schema in the scope, in one request. */
  async schemas(options: RequestOptions = {}): Promise<CollectionDefinition[]> {
    const body = await this.scope.transport.json<{ items: CollectionDefinition[] }>({
      method: "GET",
      path: ApiPath.schemas(this.scope.project, this.scope.environment),
      ...options,
    });
    return body.items;
  }

  async search(query: SearchQuery, options: RequestOptions = {}): Promise<SearchPage> {
    return new Search(
      this.scope.transport,
      SearchReach.environment(this.scope.project, this.scope.environment),
    ).run(query, options);
  }

  async rename(name: string, options: RenameOptions = {}): Promise<RenameReport> {
    const payload = await this.scope.transport.json<RenamePreviewPayload>({
      method: "PATCH",
      path: ApiPath.environment(this.scope.project, this.scope.environment),
      query: { dry_run: options.dryRun || undefined, expected_id: options.expectedId },
      body: { name },
      signal: options.signal,
      timeoutMilliseconds: options.timeoutMilliseconds,
    });
    return RenameReport.fromWire(payload);
  }

  async delete(options: DeleteOptions = {}): Promise<void> {
    await this.scope.transport.empty({
      method: "DELETE",
      path: ApiPath.environment(this.scope.project, this.scope.environment),
      query: { force: options.force || undefined },
      signal: options.signal,
      timeoutMilliseconds: options.timeoutMilliseconds,
    });
  }
}
