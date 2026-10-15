package in.org.quicko.silo.client.trash;

import com.fasterxml.jackson.databind.JsonNode;
import in.org.quicko.silo.client.RequestOptions;
import in.org.quicko.silo.client.pagination.Page;
import in.org.quicko.silo.client.pagination.PageWindow;
import in.org.quicko.silo.client.transport.ApiPath;
import in.org.quicko.silo.client.transport.Transport;
import in.org.quicko.silo.client.transport.TransportRequest;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * One page of the trash, navigated by the window the server echoed. {@link Trash}
 * builds the wire query once and every page reuses it unchanged.
 */
public final class TrashPage extends Page<TrashRecord> {
  private final Transport transport;
  private final Map<String, Object> wireQuery;

  private TrashPage(
      List<TrashRecord> rows,
      int total,
      PageWindow window,
      Transport transport,
      Map<String, Object> wireQuery) {
    super(rows, total, window);
    this.transport = transport;
    this.wireQuery = wireQuery;
  }

  public List<TrashRecord> items() {
    return rows();
  }

  public Optional<TrashPage> next() {
    return next(RequestOptions.none());
  }

  public Optional<TrashPage> next(RequestOptions options) {
    return windowForNext().map(window -> load(transport, wireQuery, window, options));
  }

  public Optional<TrashPage> previous() {
    return previous(RequestOptions.none());
  }

  public Optional<TrashPage> previous(RequestOptions options) {
    return window().previous().map(window -> load(transport, wireQuery, window, options));
  }

  static TrashPage load(
      Transport transport, Map<String, Object> wireQuery, PageWindow window, RequestOptions options) {
    JsonNode body = transport.json(
        TransportRequest.get(ApiPath.trash())
            .queries(wireQuery)
            .query("limit", window.limit())
            .query("offset", window.offset())
            .options(options)
            .build());

    List<TrashRecord> records = new ArrayList<>();
    body.path("items").forEach(item -> records.add(TrashRecord.fromWire(item)));

    PageWindow answered = new PageWindow(
        body.path("limit").isNumber() ? body.get("limit").asInt() : window.limit(),
        body.path("offset").isNumber() ? body.get("offset").asInt() : window.offset());

    return new TrashPage(records, body.path("total").asInt(0), answered, transport, wireQuery);
  }
}
