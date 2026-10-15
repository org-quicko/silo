package in.org.quicko.silo.client.trash;

import com.fasterxml.jackson.databind.JsonNode;
import in.org.quicko.silo.client.RequestOptions;
import in.org.quicko.silo.client.pagination.PageWindow;
import in.org.quicko.silo.client.transport.ApiPath;
import in.org.quicko.silo.client.transport.Transport;
import in.org.quicko.silo.client.transport.TransportRequest;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * The trash (D113): what a delete left behind, and the two ways out of it.
 *
 * <p>Instance-global like the media library, so it hangs off {@code silo} and
 * takes no scope. Reading needs no claim of its own: the server shows each key
 * only the items whose content its read claims reach.
 */
public final class Trash {
  private final Transport transport;

  public Trash(Transport transport) {
    this.transport = transport;
  }

  public TrashPage list() {
    return list(TrashQuery.all(), RequestOptions.none());
  }

  public TrashPage list(TrashQuery query) {
    return list(query, RequestOptions.none());
  }

  public TrashPage list(TrashQuery query, RequestOptions options) {
    PageWindow window = new PageWindow(query.limitOrDefault(), query.offsetOrDefault());
    return TrashPage.load(transport, toWireQuery(query), window, options);
  }

  public TrashRecord get(String id) {
    return get(id, RequestOptions.none());
  }

  public TrashRecord get(String id, RequestOptions options) {
    return TrashRecord.fromWire(transport.json(
        TransportRequest.get(ApiPath.trashItem(id)).options(options).build()));
  }

  public TrashParkedRecords contents(String id) {
    return contents(id, TrashContentsQuery.all(), RequestOptions.none());
  }

  /** The records this receipt parked. Read-only: a restore is all or nothing
   *  per receipt. */
  public TrashParkedRecords contents(String id, TrashContentsQuery query, RequestOptions options) {
    return TrashParkedRecords.fromWire(transport.json(
        TransportRequest.get(ApiPath.trashItemContents(id))
            .query("limit", query.limit())
            .query("offset", query.offset())
            .options(options)
            .build()));
  }

  public TrashRestoreResult restore(String id) {
    return restore(id, TrashRestoreOptions.none());
  }

  /** Puts the content back. Needs the write claims at the destination; a
   *  blocked or colliding restore raises {@code ConflictException}. */
  public TrashRestoreResult restore(String id, TrashRestoreOptions options) {
    Map<String, Object> body = new LinkedHashMap<>();
    if (options.rename() != null) body.put("rename", options.rename());
    body.put("chain", options.chain());
    return TrashRestoreResult.fromWire(transport.json(
        TransportRequest.post(ApiPath.trashRestore(id))
            .body(body)
            .options(options.request())
            .build()));
  }

  public void purge(String id) {
    purge(id, RequestOptions.none());
  }

  /** Destroys one receipt and everything it parked. Needs {@code trash:purge}. */
  public void purge(String id, RequestOptions options) {
    transport.empty(TransportRequest.delete(ApiPath.trashItem(id)).options(options).build());
  }

  public long empty() {
    return empty(RequestOptions.none());
  }

  /**
   * Empties the trash and answers how many receipts it destroyed. Needs
   * {@code trash:purge}. Sends the confirmation word the route asks for,
   * because calling {@code empty} is already the deliberate act that word guards.
   */
  public long empty(RequestOptions options) {
    JsonNode body = transport.json(
        TransportRequest.post(ApiPath.trashPurge())
            .body(Map.of("confirm", "empty"))
            .options(options)
            .build());
    return body.path("purged").asLong(0);
  }

  private static Map<String, Object> toWireQuery(TrashQuery query) {
    Map<String, Object> wire = new LinkedHashMap<>();
    if (query.kind() != null) wire.put("kind", query.kind().wireValue());
    if (query.project() != null) wire.put("project", query.project());
    if (query.environment() != null) wire.put("env", query.environment());
    if (query.collection() != null) wire.put("collection", query.collection());
    if (query.deletedAfter() != null) wire.put("deleted_after", query.deletedAfter().toString());
    if (query.deletedBefore() != null) wire.put("deleted_before", query.deletedBefore().toString());
    if (query.text() != null) wire.put("q", query.text());
    return wire;
  }
}
