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
import in.org.quicko.silo.client.scope.RenameOptions;
import in.org.quicko.silo.client.scope.RenameReport;
import in.org.quicko.silo.client.scope.ScopeReference;
import in.org.quicko.silo.client.search.Search;
import in.org.quicko.silo.client.search.SearchPage;
import in.org.quicko.silo.client.search.SearchQuery;
import in.org.quicko.silo.client.search.SearchReach;
import in.org.quicko.silo.client.transport.ApiPath;
import in.org.quicko.silo.client.transport.TransportRequest;
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
  private final EntryReader<F> reader;
  private final CollectionSchema schema;

  public CollectionHandle(ScopeReference scope, String name, JavaType fieldsType) {
    this.scope = scope;
    this.name = name;
    this.fieldsType = fieldsType;
    this.reader = new EntryReader<>(scope, name, fieldsType);
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
    return reader.get(id, EntryReadOptions.none());
  }

  public Entry<F> get(String id, EntryReadOptions options) {
    return reader.get(id, options);
  }

  public EntryPage<F> list() {
    return reader.list(EntryListQuery.all(), EntryReadOptions.none());
  }

  public EntryPage<F> list(EntryListQuery query) {
    return reader.list(query, EntryReadOptions.none());
  }

  public EntryPage<F> list(EntryListQuery query, EntryReadOptions options) {
    return reader.list(query, options);
  }

  /** Every matching entry, paged lazily. */
  public EntryStream<F> all() {
    return reader.all(EntryListQuery.all(), EntryReadOptions.none());
  }

  public EntryStream<F> all(EntryListQuery query) {
    return reader.all(query, EntryReadOptions.none());
  }

  public EntryStream<F> all(EntryListQuery query, EntryReadOptions options) {
    return reader.all(query, options);
  }

  /** Every matching page, one at a time. */
  public EntryPageStream<F> pages() {
    return reader.pages(EntryListQuery.all(), EntryReadOptions.none());
  }

  public EntryPageStream<F> pages(EntryListQuery query) {
    return reader.pages(query, EntryReadOptions.none());
  }

  public EntryPageStream<F> pages(EntryListQuery query, EntryReadOptions options) {
    return reader.pages(query, options);
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
            SearchReach.collection(scope.project(), scope.environment(), name))
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
