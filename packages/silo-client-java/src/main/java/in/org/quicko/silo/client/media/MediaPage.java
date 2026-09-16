package in.org.quicko.silo.client.media;

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
 * One page of the library, navigated by the window the server echoed rather than
 * the one requested. {@link Media} builds the wire query once and every page
 * reuses it unchanged.
 */
public final class MediaPage extends Page<MediaAsset> {
  private final Transport transport;
  private final Map<String, Object> wireQuery;

  private MediaPage(
      List<MediaAsset> rows,
      int total,
      PageWindow window,
      Transport transport,
      Map<String, Object> wireQuery) {
    super(rows, total, window);
    this.transport = transport;
    this.wireQuery = wireQuery;
  }

  public List<MediaAsset> files() {
    return rows();
  }

  public Optional<MediaPage> next() {
    return next(RequestOptions.none());
  }

  public Optional<MediaPage> next(RequestOptions options) {
    return windowForNext().map(window -> load(transport, wireQuery, window, options));
  }

  public Optional<MediaPage> previous() {
    return previous(RequestOptions.none());
  }

  public Optional<MediaPage> previous(RequestOptions options) {
    return window().previous().map(window -> load(transport, wireQuery, window, options));
  }

  static MediaPage load(
      Transport transport, Map<String, Object> wireQuery, PageWindow window, RequestOptions options) {
    JsonNode body = transport.json(
        TransportRequest.get(ApiPath.media())
            .queries(wireQuery)
            .query("limit", window.limit())
            .query("offset", window.offset())
            .options(options)
            .build());

    List<MediaAsset> assets = new ArrayList<>();
    body.path("items").forEach(item ->
        assets.add(new MediaAsset(transport, MediaMapper.toRecord(item))));

    PageWindow answered = new PageWindow(
        body.path("limit").isNumber() ? body.get("limit").asInt() : window.limit(),
        body.path("offset").isNumber() ? body.get("offset").asInt() : window.offset());

    return new MediaPage(assets, body.path("total").asInt(0), answered, transport, wireQuery);
  }
}
