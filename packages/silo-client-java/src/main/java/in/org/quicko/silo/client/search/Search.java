package in.org.quicko.silo.client.search;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JavaType;
import com.fasterxml.jackson.databind.JsonNode;
import in.org.quicko.silo.client.RequestOptions;
import in.org.quicko.silo.client.entries.Entry;
import in.org.quicko.silo.client.entries.EntryMapper;
import in.org.quicko.silo.client.pagination.PageWindow;
import in.org.quicko.silo.client.transport.JsonValues;
import in.org.quicko.silo.client.transport.PagePayload;
import in.org.quicko.silo.client.transport.Transport;
import in.org.quicko.silo.client.transport.TransportRequest;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Search, bound to one reach. {@code CollectionHandle.search},
 * {@code EnvironmentHandle.search} and {@code Silo.search} each construct one of
 * these against their own reach rather than exposing the reach as an argument.
 */
public final class Search {
  private final Transport transport;
  private final SearchReach reach;

  public Search(Transport transport, SearchReach reach) {
    this.transport = transport;
    this.reach = reach;
  }

  public SearchPage run(SearchQuery query, RequestOptions options) {
    JsonNode body = transport.json(
        TransportRequest.get(reach.path())
            .query("q", query.text())
            .query("filter", query.where() == null ? null : query.where().toJson(transport.codec()))
            .query("sort", query.sort())
            .query("limit", query.limit())
            .query("offset", query.offset())
            .options(options)
            .build());

    PagePayload payload = PagePayload.read(body);
    PageWindow window = new PageWindow(
        payload.limit() == null ? query.limitOrDefault() : payload.limit(),
        payload.offset() == null ? query.offsetOrDefault() : payload.offset());

    List<SearchHit> hits = new ArrayList<>(payload.rows().size());
    for (JsonNode row : payload.rows()) {
      hits.add(toHit(row));
    }

    return new SearchPage(
        hits,
        payload.total(),
        window,
        body.path("truncated").asBoolean(false),
        SearchEngine.of(body.path("engine").asText("scan")),
        next -> run(query.limit(next.limit()).offset(next.offset()), options));
  }

  /**
   * {@code env} is the only rename: the hit's own location, which sits on the
   * hit rather than on the entry so a result found outside the scope on screen
   * can still be linked to.
   */
  private SearchHit toHit(JsonNode payload) {
    Entry<Map<String, Object>> entry =
        EntryMapper.read(payload.path("entry"), untypedFields(), transport.codec());

    List<SearchSnippet> snippets = new ArrayList<>();
    payload.path("snippets").forEach(snippet -> snippets.add(new SearchSnippet(
        JsonValues.text(snippet, "path"),
        JsonValues.text(snippet, "before"),
        JsonValues.text(snippet, "match"),
        JsonValues.text(snippet, "after"))));

    return new SearchHit(
        JsonValues.text(payload, "project"),
        JsonValues.text(payload, "env"),
        JsonValues.text(payload, "collection"),
        entry,
        snippets);
  }

  private JavaType untypedFields() {
    return transport.codec().typeOf(new TypeReference<Map<String, Object>>() { });
  }
}
