import type { Entry } from "../entries/entry.js";
import type { EntryListQuery } from "../entries/entry-list-query.js";
import type { EntryPage } from "../entries/entry-page.js";
import type { EntryPageStream } from "../entries/entry-page-stream.js";
import type { EntryReadOptions } from "../entries/entry-read-options.js";
import { EntryReader } from "../entries/entry-reader.js";
import type { EntryStream } from "../entries/entry-stream.js";
import { TypedFilter } from "../query/typed-filter.js";
import type { RequestOptions } from "../request-options.js";
import { RenameReport, type RenamePreviewPayload } from "../scope/rename-report.js";
import type { RenameOptions } from "../scope/rename-options.js";
import type { ScopeReference } from "../scope/scope-reference.js";
import { Search } from "../search/search.js";
import type { SearchPage } from "../search/search-page.js";
import type { SearchQuery } from "../search/search-query.js";
import { SearchReach } from "../search/search-reach.js";
import { TrashHeader } from "../trash-header.js";
import { ApiPath } from "../transport/api-path.js";
import { TransportRequest } from "../transport/transport-request.js";
import { CollectionSchema } from "./collection-schema.js";

/**
 * One collection, typed to its fields:
 * `environment.collection<Post>("posts")`.
 *
 * Reads answer the wire's own flat rows and writes take explicit arguments, so
 * there is one entry shape here and no second read surface. Pass
 * `{ variables: "raw" }` to any read to get the stored `{{NAME}}` templates
 * instead of what they resolve to, which is what editing one requires (D62).
 */
export class CollectionHandle<Fields = Record<string, unknown>> {
  readonly filter = new TypedFilter<Fields>();
  readonly schema: CollectionSchema;

  private readonly reader: EntryReader<Fields>;

  constructor(
    private readonly scope: ScopeReference,
    readonly name: string,
  ) {
    this.schema = new CollectionSchema(scope, name);
    this.reader = new EntryReader<Fields>(scope, name);
  }

  get(id: string, options: EntryReadOptions = {}): Promise<Entry<Fields>> {
    return this.reader.get(id, options);
  }

  list(query: EntryListQuery = {}, options: EntryReadOptions = {}): Promise<EntryPage<Entry<Fields>>> {
    return this.reader.list(query, options);
  }

  all(query: EntryListQuery = {}, options: EntryReadOptions = {}): EntryStream<Entry<Fields>> {
    return this.reader.all(query, options);
  }

  pages(query: EntryListQuery = {}, options: EntryReadOptions = {}): EntryPageStream<Entry<Fields>> {
    return this.reader.pages(query, options);
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

  /** A full replace, which is what the route is: send every field. `rev` is
   * the one the entry answered when it was read, and a stale one is a
   * `ConflictError`. */
  replace(id: string, rev: number, fields: Fields, options: RequestOptions = {}): Promise<Entry<Fields>> {
    return this.write(
      "PUT",
      ApiPath.entry(this.scope.project, this.scope.environment, this.name, id),
      fields,
      rev,
      options,
    );
  }

  /** Answers the trash receipt's id, or null when the delete was permanent or
   *  the instance keeps no trash (D91). */
  async delete(id: string, rev: number, options: RequestOptions = {}): Promise<string | null> {
    const headers = await this.scope.transport.emptyWithHeaders(
      TransportRequest.of("DELETE", ApiPath.entry(this.scope.project, this.scope.environment, this.name, id))
        .query("rev", rev)
        .options(options)
        .evicts(this.entries())
        .build(),
    );
    return TrashHeader.read(headers);
  }

  search(query: SearchQuery, options: RequestOptions = {}): Promise<SearchPage> {
    return new Search(
      this.scope.transport,
      SearchReach.collection(this.scope.project, this.scope.environment, this.name),
    ).run(query, options);
  }

  async rename(name: string, options: RenameOptions = {}): Promise<RenameReport> {
    const payload = await this.scope.transport.json<RenamePreviewPayload>(
      TransportRequest.of("PATCH", ApiPath.collection(this.scope.project, this.scope.environment, this.name))
        .query("dry_run", options.dryRun || undefined)
        .query("expected_id", options.expectedId)
        .body({ name })
        .options(options)
        .evicts(this.entries())
        .build(),
    );
    return RenameReport.fromWire(payload);
  }

  /** Both writes ask for the stored templates back, so what returns is what
   *  was sent rather than a resolved snapshot of it. */
  private write(
    method: "POST" | "PUT",
    path: string,
    fields: Fields,
    rev: number | undefined,
    options: RequestOptions,
  ): Promise<Entry<Fields>> {
    return this.scope.transport.json<Entry<Fields>>(
      TransportRequest.of(method, path)
        .query("rev", rev)
        .query("variables", "raw")
        .body(fields)
        .options(options)
        .evicts(this.entries())
        .build(),
    );
  }

  private entries(): string {
    return ApiPath.entries(this.scope.project, this.scope.environment, this.name);
  }
}
