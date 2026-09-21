package in.org.quicko.silo.client.media;

import com.fasterxml.jackson.databind.JsonNode;
import in.org.quicko.silo.client.RequestOptions;
import in.org.quicko.silo.client.pagination.Page;
import in.org.quicko.silo.client.pagination.PageWindow;
import in.org.quicko.silo.client.transport.ApiPath;
import in.org.quicko.silo.client.transport.Transport;
import in.org.quicko.silo.client.transport.TransportRequest;
import java.util.List;
import java.util.Optional;
import java.util.OptionalInt;

/**
 * One page of an asset's referrers, and the awkward page shape.
 *
 * <p>The wire gives a true {@code total} this key may not fully see, plus
 * {@code visible} (what it may) and {@code visibleCapped}, and echoes no window
 * at all. {@link #total()} keeps reporting the true count; {@link #pageCount()}
 * and {@link #hasMore()} are overridden to derive from {@link #visible()}
 * instead, since that is all these rows can ever add up to.
 */
public final class MediaUsagePage extends Page<MediaUsage> {
  /** The usages route's own fallback when a limit is not asked for. */
  private static final int DefaultLimit = 50;

  private final long visible;
  private final boolean visibleCapped;
  private final Transport transport;
  private final String assetId;

  private MediaUsagePage(
      List<MediaUsage> rows,
      int total,
      long visible,
      boolean visibleCapped,
      PageWindow window,
      Transport transport,
      String assetId) {
    super(rows, total, window);
    this.visible = visible;
    this.visibleCapped = visibleCapped;
    this.transport = transport;
    this.assetId = assetId;
  }

  public List<MediaUsage> usages() {
    return rows();
  }

  /** How many referrers this key is allowed to see. */
  public long visible() {
    return visible;
  }

  /** True when the server stopped counting before it ran out of referrers. */
  public boolean visibleCapped() {
    return visibleCapped;
  }

  @Override
  public OptionalInt pageCount() {
    return OptionalInt.of(Math.max(1, (int) Math.ceil((double) visible / limit())));
  }

  @Override
  public boolean hasMore() {
    return offset() + size() < visible;
  }

  public Optional<MediaUsagePage> next() {
    return next(RequestOptions.none());
  }

  public Optional<MediaUsagePage> next(RequestOptions options) {
    return windowForNext().map(window -> load(transport, assetId, window, options));
  }

  public Optional<MediaUsagePage> previous() {
    return previous(RequestOptions.none());
  }

  public Optional<MediaUsagePage> previous(RequestOptions options) {
    return window().previous().map(window -> load(transport, assetId, window, options));
  }

  static MediaUsagePage first(
      Transport transport, String assetId, MediaUsageQuery query, RequestOptions options) {
    PageWindow window = new PageWindow(
        query.limit() == null ? DefaultLimit : query.limit(),
        query.offset() == null ? 0 : query.offset());
    return load(transport, assetId, window, options);
  }

  private static MediaUsagePage load(
      Transport transport, String assetId, PageWindow window, RequestOptions options) {
    JsonNode body = transport.json(
        TransportRequest.get(ApiPath.mediaAssetUsages(assetId))
            .query("limit", window.limit())
            .query("offset", window.offset())
            .options(options)
            .build());

    return new MediaUsagePage(
        MediaMapper.toUsages(body.get("items")),
        body.path("total").asInt(0),
        body.path("visible").asLong(0),
        body.path("visible_capped").asBoolean(false),
        window,
        transport,
        assetId);
  }
}
