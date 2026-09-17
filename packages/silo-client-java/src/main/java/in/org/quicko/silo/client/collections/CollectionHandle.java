package in.org.quicko.silo.client.collections;

import com.fasterxml.jackson.databind.JavaType;
import com.fasterxml.jackson.databind.JsonNode;
import in.org.quicko.silo.client.RequestOptions;
import in.org.quicko.silo.client.entries.Entry;
import in.org.quicko.silo.client.entries.EntryListQuery;
import in.org.quicko.silo.client.entries.EntryMapper;
import in.org.quicko.silo.client.entries.EntryPage;
import in.org.quicko.silo.client.entries.EntryPageStream;
import in.org.quicko.silo.client.entries.EntryReadOptions;
import in.org.quicko.silo.client.entries.EntryReader;
import in.org.quicko.silo.client.entries.EntryStream;
import in.org.quicko.silo.client.pagination.PageWindow;
import in.org.quicko.silo.client.pagination.RowBatch;
import in.org.quicko.silo.client.pagination.RowLoader;
import in.org.quicko.silo.client.scope.RenameOptions;
import in.org.quicko.silo.client.scope.RenameReport;
import in.org.quicko.silo.client.scope.ScopeReference;
import in.org.quicko.silo.client.search.Search;
import in.org.quicko.silo.client.search.SearchPage;
import in.org.quicko.silo.client.search.SearchQuery;
import in.org.quicko.silo.client.search.SearchReach;
import in.org.quicko.silo.client.transport.ApiPath;
import in.org.quicko.silo.client.transport.PagePayload;
import in.org.quicko.silo.client.transport.TransportRequest;
import java.util.List;
import java.util.Map;

/**
 * One collection, typed to its fields: {@code environment.collection("posts",
 * Post.class)}.
 *
 * <p>Reads answer {@link Entry} values and writes take explicit arguments, so
 * there is one entry shape here and no second read surface. Pass
 * {@link EntryReadOptions#raw()} to any read to get the stored
 * {@code {{NAME}}} templates instead of what they resolve to, which is what
 * editing one requires.
 */
public final class CollectionHandle<F> {
  private final ScopeReference scope;
  private final String name;
  private final JavaType fieldsType;
  private final EntryReader reader;
  private final CollectionSchema schema;

  public CollectionHandle(ScopeReference scope, String name, JavaType fieldsType) {
    this.scope = scope;
    this.name = name;
    this.fieldsType = fieldsType;
    this.reader = scope.cache().wrap(new EntryReader(scope, name));
    this.schema = new CollectionSchema(scope, name);
  }

  public String name() {
    return name;
  }

  /** This collection's schema, and the only route that deletes the collection. */
  public CollectionSchema schema() {
    return schema;
  }

  public Entry<F> get(String id) {
    return get(id, EntryReadOptions.none());
  }

  public Entry<F> get(String id, EntryReadOptions options) {
    String path = ApiPath.entry(scope.project(), scope.environment(), name, id);
    options.request().throwIfCancelled("GET", path);
    JsonNode row = scope.transport().codec().tree(reader.get(id, options));
    options.request().throwIfCancelled("GET", path);
    return EntryMapper.read(row, fieldsType, scope.transport().codec());
  }

  public EntryPage<F> list() {
    return list(EntryListQuery.all(), EntryReadOptions.none());
  }

  public EntryPage<F> list(EntryListQuery query) {
    return list(query, EntryReadOptions.none());
  }

  public EntryPage<F> list(EntryListQuery query, EntryReadOptions options) {
    String path = ApiPath.entries(scope.project(), scope.environment(), name);
    options.request().throwIfCancelled("GET", path);
    PagePayload payload = PagePayload.read(scope.transport().codec().tree(reader.list(query, options)));
    options.request().throwIfCancelled("GET", path);
    PageWindow window = new PageWindow(
        payload.limit() == null ? query.limitOrDefault() : payload.limit(),
        payload.offset() == null ? query.offsetOrDefault() : payload.offset());
    List<Entry<F>> entries = payload.rows().stream()
        .map(row -> EntryMapper.<F>read(row, fieldsType, scope.transport().codec())).toList();
    return new EntryPage<>(entries, payload.total(), window,
        next -> list(query.limit(next.limit()).offset(next.offset()), options));
  }

  /** Every matching entry, paged lazily. */
  public EntryStream<F> all() {
    return all(EntryListQuery.all(), EntryReadOptions.none());
  }

  public EntryStream<F> all(EntryListQuery query) {
    return all(query, EntryReadOptions.none());
  }

  public EntryStream<F> all(EntryListQuery query, EntryReadOptions options) {
    RowLoader<Entry<F>> loader = window -> {
      EntryPage<F> page = list(query.limit(window.limit()).offset(window.offset()), options);
      return new RowBatch<>(page.entries(), new PageWindow(page.limit(), page.offset()));
    };
    return new EntryStream<>(loader, query.limitOrDefault(), options.request());
  }

  /** Every matching page, one at a time. */
  public EntryPageStream<F> pages() {
    return pages(EntryListQuery.all(), EntryReadOptions.none());
  }

  public EntryPageStream<F> pages(EntryListQuery query) {
    return pages(query, EntryReadOptions.none());
  }

  public EntryPageStream<F> pages(EntryListQuery query, EntryReadOptions options) {
    return new EntryPageStream<>(() -> list(query, options), options.request());
  }

  public Entry<F> create(F fields) {
    return create(fields, RequestOptions.none());
  }

  public Entry<F> create(F fields, RequestOptions options) {
    return write("POST", ApiPath.entries(scope.project(), scope.environment(), name), fields, null, options);
  }

  /**
   * A full replace, which is what the route is: send every field. {@code rev} is
   * the one the entry answered when it was read, and a stale one raises
   * {@link in.org.quicko.silo.client.errors.ConflictException}.
   */
  public Entry<F> replace(String id, long rev, F fields) {
    return replace(id, rev, fields, RequestOptions.none());
  }

  public Entry<F> replace(String id, long rev, F fields, RequestOptions options) {
    return write("PUT", ApiPath.entry(scope.project(), scope.environment(), name, id), fields, rev, options);
  }

  public void delete(String id, long rev) {
    delete(id, rev, RequestOptions.none());
  }

  public void delete(String id, long rev, RequestOptions options) {
    scope.transport().empty(
        TransportRequest.delete(ApiPath.entry(scope.project(), scope.environment(), name, id))
            .query("rev", rev)
            .options(options)
            .build());
  }

  public SearchPage search(SearchQuery query) {
    return search(query, RequestOptions.none());
  }

  /** Searches this collection only. The reach is the receiver, never an
   *  argument that could be forgotten and widen the search. */
  public SearchPage search(SearchQuery query, RequestOptions options) {
    return new Search(
            scope.transport(),
            SearchReach.collection(scope.project(), scope.environment(), name), reader)
        .run(query, options);
  }

  public RenameReport rename(String newName) {
    return rename(newName, RenameOptions.none());
  }

  public RenameReport rename(String newName, RenameOptions options) {
    return RenameReport.fromWire(scope.transport().json(
        TransportRequest.patch(ApiPath.collection(scope.project(), scope.environment(), name))
            .query("dry_run", options.dryRun() ? true : null)
            .query("expected_id", options.expectedId())
            .body(Map.of("name", newName))
            .options(options.request())
            .build()));
  }

  /** Both writes ask for the stored templates back, so what returns is what was
   *  sent rather than a resolved snapshot of it. */
  private Entry<F> write(String method, String path, F fields, Long rev, RequestOptions options) {
    JsonNode row = scope.transport().json(
        TransportRequest.of(method, path)
            .query("rev", rev)
            .query("variables", "raw")
            .body(fields)
            .options(options)
            .build());
    return EntryMapper.read(row, fieldsType, scope.transport().codec());
  }
}
