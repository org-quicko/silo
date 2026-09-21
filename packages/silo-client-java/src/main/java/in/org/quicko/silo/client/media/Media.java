package in.org.quicko.silo.client.media;

import com.fasterxml.jackson.databind.JsonNode;
import in.org.quicko.silo.client.RequestOptions;
import in.org.quicko.silo.client.pagination.PageWindow;
import in.org.quicko.silo.client.pagination.RowBatch;
import in.org.quicko.silo.client.pagination.RowLoader;
import in.org.quicko.silo.client.scope.DeleteOptions;
import in.org.quicko.silo.client.transport.ApiPath;
import in.org.quicko.silo.client.transport.JsonValues;
import in.org.quicko.silo.client.transport.Transport;
import in.org.quicko.silo.client.transport.TransportRequest;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The media library. It is instance-global and never scoped to a project or an
 * environment, which is why it hangs off {@code silo} rather than off a scope.
 */
public final class Media {
  /** Caps a bulk delete before it reaches the server's own cap: a local refusal
   *  reads better than a 400 for the 101st id. */
  private static final int BulkDeleteCap = 100;

  private final Transport transport;
  private final MediaFolders folders;

  public Media(Transport transport) {
    this.transport = transport;
    this.folders = new MediaFolders(transport);
  }

  /** The folder tree, which exists as records rather than as a side effect of
   *  what has been filed. */
  public MediaFolders folders() {
    return folders;
  }

  public MediaAsset upload(MediaUpload input) {
    return upload(input, RequestOptions.none());
  }

  public MediaAsset upload(MediaUpload input, RequestOptions options) {
    JsonNode payload = transport.upload(
        TransportRequest.post(ApiPath.media()).options(options).build(),
        MediaParts.form(input.bytes(), input.filename(), input.contentType(), input.folder()));
    return new MediaAsset(transport, MediaMapper.toRecord(payload));
  }

  public MediaAsset get(String id) {
    return get(id, RequestOptions.none());
  }

  public MediaAsset get(String id, RequestOptions options) {
    JsonNode payload = transport.json(
        TransportRequest.get(ApiPath.mediaAsset(id)).options(options).build());
    return new MediaAsset(transport, MediaMapper.toRecord(payload));
  }

  public MediaPage list() {
    return list(MediaQuery.all(), RequestOptions.none());
  }

  public MediaPage list(MediaQuery query) {
    return list(query, RequestOptions.none());
  }

  public MediaPage list(MediaQuery query, RequestOptions options) {
    PageWindow window = new PageWindow(query.limitOrDefault(), query.offsetOrDefault());
    return MediaPage.load(transport, toWireQuery(query), window, options);
  }

  /** One asset at a time, across every page. */
  public MediaStream all() {
    return all(MediaQuery.all(), RequestOptions.none());
  }

  public MediaStream all(MediaQuery query) {
    return all(query, RequestOptions.none());
  }

  public MediaStream all(MediaQuery query, RequestOptions options) {
    Map<String, Object> wireQuery = toWireQuery(query);
    RowLoader<MediaAsset> loader = window -> {
      MediaPage page = MediaPage.load(transport, wireQuery, window, options);
      return new RowBatch<>(page.files(), new PageWindow(page.limit(), page.offset()));
    };
    return new MediaStream(loader, query.limitOrDefault(), options);
  }

  /** One whole page at a time, across every page. */
  public MediaPageStream pages() {
    return pages(MediaQuery.all(), RequestOptions.none());
  }

  public MediaPageStream pages(MediaQuery query) {
    return pages(query, RequestOptions.none());
  }

  public MediaPageStream pages(MediaQuery query, RequestOptions options) {
    return new MediaPageStream(() -> list(query, options), options);
  }

  public List<String> extensions() {
    return extensions(RequestOptions.none());
  }

  /** Every distinct file extension actually in the library. */
  public List<String> extensions(RequestOptions options) {
    JsonNode body = transport.json(
        TransportRequest.get(ApiPath.mediaExtensions()).options(options).build());
    return JsonValues.strings(body.get("items"));
  }

  public MediaDeleteReport deleteMany(List<String> ids) {
    return deleteMany(ids, DeleteOptions.none());
  }

  /**
   * Always answers a 200: every id's outcome lives in the report rather than in
   * a thrown exception, so a partial success is a value rather than something to
   * infer.
   */
  public MediaDeleteReport deleteMany(List<String> ids, DeleteOptions options) {
    if (ids.size() > BulkDeleteCap) {
      throw new IllegalArgumentException(
          "deleteMany accepts at most " + BulkDeleteCap + " ids per request, got " + ids.size());
    }
    return MediaDeleteReport.fromWire(transport.json(
        TransportRequest.post(ApiPath.mediaBulkDelete())
            .body(Map.of("ids", List.copyOf(ids), "force", options.force()))
            .options(options.request())
            .build()));
  }

  private static Map<String, Object> toWireQuery(MediaQuery query) {
    Map<String, Object> wire = new LinkedHashMap<>();
    if (query.text() != null) wire.put("q", query.text());
    if (query.folder() != null) wire.put("folder", query.folder());
    if (query.recursive() != null) wire.put("recursive", query.recursive());
    if (query.type() != null) wire.put("type", query.type());
    if (query.extension() != null) wire.put("ext", query.extension());
    if (query.tag() != null) wire.put("tag", query.tag());
    if (query.modifiedAfter() != null) wire.put("modified_after", query.modifiedAfter().toString());
    if (query.modifiedBefore() != null) wire.put("modified_before", query.modifiedBefore().toString());
    if (query.sort() != null) wire.put("sort", query.sort());
    return wire;
  }
}
