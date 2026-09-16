package in.org.quicko.silo.client.entries;

import com.fasterxml.jackson.databind.JavaType;
import com.fasterxml.jackson.databind.JsonNode;
import in.org.quicko.silo.client.pagination.PageWindow;
import in.org.quicko.silo.client.pagination.RowBatch;
import in.org.quicko.silo.client.pagination.RowLoader;
import in.org.quicko.silo.client.scope.ScopeReference;
import in.org.quicko.silo.client.transport.ApiPath;
import in.org.quicko.silo.client.transport.JsonCodec;
import in.org.quicko.silo.client.transport.PagePayload;
import in.org.quicko.silo.client.transport.TransportRequest;
import java.util.ArrayList;
import java.util.List;

/**
 * The four reads of one collection: one entry, one page, every entry, every page.
 *
 * <p>What this class owns is the paging the four share and the one place
 * {@code variables} becomes a query parameter. Nothing else is mapped on the way
 * through: {@link EntryMapper} splits the envelope off and copies the rest.
 */
public final class EntryReader<F> {
  private final ScopeReference scope;
  private final String collection;
  private final JavaType fieldsType;

  public EntryReader(ScopeReference scope, String collection, JavaType fieldsType) {
    this.scope = scope;
    this.collection = collection;
    this.fieldsType = fieldsType;
  }

  public Entry<F> get(String id, EntryReadOptions options) {
    JsonNode row = scope.transport().json(
        TransportRequest.get(ApiPath.entry(scope.project(), scope.environment(), collection, id))
            .query("variables", options.variables().wireValue())
            .options(options.request())
            .build());
    return EntryMapper.read(row, fieldsType, codec());
  }

  public EntryPage<F> list(EntryListQuery query, EntryReadOptions options) {
    JsonNode body = scope.transport().json(
        TransportRequest.get(ApiPath.entries(scope.project(), scope.environment(), collection))
            .query("limit", query.limit())
            .query("offset", query.offset())
            .query("filter", query.where() == null ? null : query.where().toJson(codec()))
            .query("sort", query.sort())
            .query("variables", options.variables().wireValue())
            .options(options.request())
            .build());

    PagePayload payload = PagePayload.read(body);
    PageWindow window = new PageWindow(
        payload.limit() == null ? query.limitOrDefault() : payload.limit(),
        payload.offset() == null ? query.offsetOrDefault() : payload.offset());

    return new EntryPage<>(
        toEntries(payload.rows()),
        payload.total(),
        window,
        next -> list(query.limit(next.limit()).offset(next.offset()), options));
  }

  /** Every matching entry, one at a time, a page of rows per request. */
  public EntryStream<F> all(EntryListQuery query, EntryReadOptions options) {
    RowLoader<Entry<F>> loader = window -> {
      EntryPage<F> page = list(query.limit(window.limit()).offset(window.offset()), options);
      return new RowBatch<>(page.entries(), new PageWindow(page.limit(), page.offset()));
    };
    return new EntryStream<>(loader, query.limitOrDefault(), options.request());
  }

  /** Every matching page, one at a time. */
  public EntryPageStream<F> pages(EntryListQuery query, EntryReadOptions options) {
    return new EntryPageStream<>(() -> list(query, options), options.request());
  }

  private List<Entry<F>> toEntries(List<JsonNode> rows) {
    List<Entry<F>> entries = new ArrayList<>(rows.size());
    for (JsonNode row : rows) {
      entries.add(EntryMapper.read(row, fieldsType, codec()));
    }
    return entries;
  }

  private JsonCodec codec() {
    return scope.transport().codec();
  }
}
