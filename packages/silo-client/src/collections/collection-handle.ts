import { Entry } from "../entries/entry.js";
import type { EntryContext } from "../entries/entry-base.js";
import type { EntryListQuery } from "../entries/entry-list-query.js";
import type { EntryPage } from "../entries/entry-page.js";
import type { EntryPageStream } from "../entries/entry-page-stream.js";
import type { EntryPayload } from "../entries/entry-payload.js";
import { EntryReader } from "../entries/entry-reader.js";
import type { EntryStream } from "../entries/entry-stream.js";
import { ResolvedEntry } from "../entries/resolved-entry.js";
import { TypedFilter } from "../query/typed-filter.js";
import type { RequestOptions } from "../request-options.js";
import { RenameReport, type RenamePreviewPayload } from "../scope/rename-report.js";
import type { RenameOptions } from "../scope/rename-options.js";
import type { ScopeReference } from "../scope/scope-reference.js";
import { Search } from "../search/search.js";
import type { SearchPage } from "../search/search-page.js";
import type { SearchQuery } from "../search/search-query.js";
import { SearchReach } from "../search/search-reach.js";
import { ApiPath } from "../transport/api-path.js";
import { CollectionSchema } from "./collection-schema.js";

/**
 * One collection, typed to its fields:
 * `environment.collection<Post>("posts")`.
 *
 * Reads here substitute every `{{NAME}}` an entry holds and answer a
 * `ResolvedEntry`, which has no `save()`. Writing one back would replace the
 * reference somebody typed with whatever it happened to mean, so reading for
 * a write goes through `edit` or `editable`.
 */
export class CollectionHandle<Fields = Record<string, unknown>> {
  readonly filter = new TypedFilter<Fields>();
  readonly schema: CollectionSchema;

  /**
   * The same collection read for writing back. Every read here keeps the
   * templates as stored and answers an `Entry`, which has `save()`.
   */
  readonly editable: EntryReader<Entry<Fields>>;

  private readonly context: EntryContext;
  private readonly resolved: EntryReader<ResolvedEntry<Fields>>;

  constructor(
    private readonly scope: ScopeReference,
    readonly name: string,
  ) {
    this.schema = new CollectionSchema(scope, name);
    this.context = {
      transport: scope.transport,
      project: scope.project,
      environment: scope.environment,
      collection: name,
    };
    this.resolved = new EntryReader(
      this.context,
      undefined,
      (payload) => new ResolvedEntry<Fields>(this.context, payload),
    );
    this.editable = new EntryReader(
      this.context,
      "raw",
      (payload) => new Entry<Fields>(this.context, payload),
    );
  }

  /** One entry, with its variables substituted. Read-only: see `edit`. */
  get(id: string, options: RequestOptions = {}): Promise<ResolvedEntry<Fields>> {
    return this.resolved.get(id, options);
  }

  /** One entry as stored, ready to change and `save()`. */
  edit(id: string, options: RequestOptions = {}): Promise<Entry<Fields>> {
    return this.editable.get(id, options);
  }

  list(query: EntryListQuery = {}, options: RequestOptions = {}): Promise<EntryPage<ResolvedEntry<Fields>>> {
    return this.resolved.list(query, options);
  }

  all(query: EntryListQuery = {}, options: RequestOptions = {}): EntryStream<ResolvedEntry<Fields>> {
    return this.resolved.all(query, options);
  }

  pages(query: EntryListQuery = {}, options: RequestOptions = {}): EntryPageStream<ResolvedEntry<Fields>> {
    return this.resolved.pages(query, options);
  }

  create(fields: Fields, options: RequestOptions = {}): Promise<Entry<Fields>> {
    return this.write(
      "POST",
      ApiPath.entries(this.scope.project, this.scope.environment, this.name),
      fields,
      undefined,
      options,
    );
  }

  /** A full replace, which is what the route is: send every field. */
  replace(id: string, rev: number, fields: Fields, options: RequestOptions = {}): Promise<Entry<Fields>> {
    return this.write(
      "PUT",
      ApiPath.entry(this.scope.project, this.scope.environment, this.name, id),
      fields,
      rev,
      options,
    );
  }

  async delete(id: string, rev: number, options: RequestOptions = {}): Promise<void> {
    await this.scope.transport.empty({
      method: "DELETE",
      path: ApiPath.entry(this.scope.project, this.scope.environment, this.name, id),
      query: { rev },
      ...options,
    });
  }

  search(query: SearchQuery, options: RequestOptions = {}): Promise<SearchPage> {
    return new Search(
      this.scope.transport,
      SearchReach.collection(this.scope.project, this.scope.environment, this.name),
    ).run(query, options);
  }

  async rename(name: string, options: RenameOptions = {}): Promise<RenameReport> {
    const payload = await this.scope.transport.json<RenamePreviewPayload>({
      method: "PATCH",
      path: ApiPath.collection(this.scope.project, this.scope.environment, this.name),
      query: { dry_run: options.dryRun || undefined, expected_id: options.expectedId },
      body: { name },
      signal: options.signal,
      timeoutMilliseconds: options.timeoutMilliseconds,
    });
    return RenameReport.fromWire(payload);
  }

  /** Both writes ask for the stored templates back, so what returns is what
   *  was sent and is safe to hold and `save()` straight away. */
  private async write(
    method: "POST" | "PUT",
    path: string,
    fields: Fields,
    rev: number | undefined,
    options: RequestOptions,
  ): Promise<Entry<Fields>> {
    const payload = await this.scope.transport.json<EntryPayload>({
      method,
      path,
      query: { rev, variables: "raw" },
      body: fields,
      ...options,
    });
    return new Entry<Fields>(this.context, payload);
  }
}
