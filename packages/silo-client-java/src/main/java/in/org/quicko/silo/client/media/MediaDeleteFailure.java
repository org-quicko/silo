package in.org.quicko.silo.client.media;

import com.fasterxml.jackson.databind.JsonNode;
import in.org.quicko.silo.client.transport.JsonValues;
import java.util.List;

/**
 * One id's outcome in a bulk delete that could not remove it.
 *
 * <p>The counts and the referrers are present only for the
 * {@code "media_in_use"} code — {@code "not_found"},
 * {@code "media_delete_stalled"} and {@code "invalid_id"} carry just the id, the
 * code and the message.
 */
public record MediaDeleteFailure(
    String id,
    String code,
    String message,
    long usageCount,
    long visibleCount,
    boolean visibleCapped,
    List<MediaUsage> referrers) {

  public MediaDeleteFailure {
    referrers = List.copyOf(referrers);
  }

  public static MediaDeleteFailure fromWire(JsonNode payload) {
    return new MediaDeleteFailure(
        JsonValues.text(payload, "id"),
        JsonValues.text(payload, "code"),
        JsonValues.text(payload, "message"),
        payload.path("usage_count").asLong(0),
        payload.path("visible_count").asLong(0),
        payload.path("visible_capped").asBoolean(false),
        MediaMapper.toUsages(payload.get("referrers")));
  }
}
