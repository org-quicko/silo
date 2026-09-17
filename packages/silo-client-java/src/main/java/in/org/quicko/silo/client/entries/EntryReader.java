package in.org.quicko.silo.client.entries;

import com.fasterxml.jackson.databind.JsonNode;
import in.org.quicko.silo.client.RequestOptions;
import in.org.quicko.silo.client.scope.ScopeReference;
import in.org.quicko.silo.client.search.Search;
import in.org.quicko.silo.client.search.SearchQuery;
import in.org.quicko.silo.client.search.SearchReach;
import in.org.quicko.silo.client.transport.ApiPath;
import in.org.quicko.silo.client.transport.TransportRequest;
import org.springframework.cache.annotation.Cacheable;

/** Internal collection reads. Cached JSON is decoded afresh for each caller. */
public class EntryReader {
  private final ScopeReference scope;
  private final String collection;
  private final Search search;

  public EntryReader(ScopeReference scope, String collection) {
    this.scope = scope;
    this.collection = collection;
    this.search = new Search(scope.transport(),
        SearchReach.collection(scope.project(), scope.environment(), collection));
  }

  @Cacheable(cacheNames = "silo-collections", key = "#root.target.getEntryUrl(#p0, #p1)",
      unless = "#result == null")
  public String get(String id, EntryReadOptions options) {
    return readJson(buildEntryRequest(id, options));
  }

  @Cacheable(cacheNames = "silo-collections", key = "#root.target.getListUrl(#p0, #p1)",
      unless = "#result == null")
  public String list(EntryListQuery query, EntryReadOptions options) {
    return readJson(buildListRequest(query, options));
  }

  @Cacheable(cacheNames = "silo-collections", key = "#root.target.getSchemaUrl(#p0)",
      unless = "#result == null")
  public String getSchema(RequestOptions options) {
    return readJson(buildSchemaRequest(options));
  }

  @Cacheable(cacheNames = "silo-collections", key = "#root.target.getSearchUrl(#p0, #p1)",
      unless = "#result == null")
  public String search(SearchQuery query, RequestOptions options) {
    return readJson(search.buildRequest(query, options));
  }

  public String getSearchUrl(SearchQuery query, RequestOptions options) {
    return scope.transport().getRequestUrl(search.buildRequest(query, options));
  }

  public String getSchemaUrl(RequestOptions options) {
    return scope.transport().getRequestUrl(buildSchemaRequest(options));
  }

  public String getEntryUrl(String id, EntryReadOptions options) {
    return scope.transport().getRequestUrl(buildEntryRequest(id, options));
  }

  public String getListUrl(EntryListQuery query, EntryReadOptions options) {
    return scope.transport().getRequestUrl(buildListRequest(query, options));
  }

  private TransportRequest buildEntryRequest(String id, EntryReadOptions options) {
    return TransportRequest.get(ApiPath.entry(scope.project(), scope.environment(), collection, id))
        .query("variables", options.variables().wireValue())
        .options(options.request())
        .build();
  }

  private TransportRequest buildListRequest(EntryListQuery query, EntryReadOptions options) {
    return TransportRequest.get(ApiPath.entries(scope.project(), scope.environment(), collection))
        .query("limit", query.limit())
        .query("offset", query.offset())
        .query("filter", query.where() == null ? null : query.where().toJson(scope.transport().codec()))
        .query("sort", query.sort())
        .query("variables", options.variables().wireValue())
        .options(options.request())
        .build();
  }

  private String readJson(TransportRequest request) {
    JsonNode body = scope.transport().json(request);
    request.options().throwIfCancelled(request.method(), request.path());
    return body == null || body.isNull() ? null : body.toString();
  }

  private TransportRequest buildSchemaRequest(RequestOptions options) {
    return TransportRequest.get(ApiPath.collectionSchema(scope.project(), scope.environment(), collection))
        .options(options).build();
  }
}
