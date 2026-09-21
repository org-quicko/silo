package in.org.quicko.silo.client.media;

import com.fasterxml.jackson.databind.JsonNode;
import in.org.quicko.silo.client.transport.JsonValues;
import in.org.quicko.silo.client.transport.Timestamps;
import java.util.ArrayList;
import java.util.List;

/**
 * The explicit per-type mapper for media: renames only the wire fields this
 * client knows — {@code size}, {@code content_type}, {@code blob_key},
 * {@code usage_count}, {@code env}, {@code visible_capped} and the two
 * timestamps — and leaves {@code filename} and {@code tags} alone.
 *
 * <p>The one place media wire shapes are read, reused by every media class and
 * by {@link in.org.quicko.silo.client.errors.MediaInUseException} for its
 * referrers. There is no transform over unknown keys anywhere in this client: a
 * recursive camel-case pass would rewrite a customer's own field names.
 */
public final class MediaMapper {
  private MediaMapper() {}

  public static MediaAssetRecord toRecord(JsonNode payload) {
    return new MediaAssetRecord(
        text(payload, "id"),
        text(payload, "filename"),
        text(payload, "folder"),
        text(payload, "blob_key"),
        payload.path("size").asLong(0),
        text(payload, "content_type"),
        text(payload, "hash"),
        MediaState.of(text(payload, "state")),
        JsonValues.strings(payload.get("tags")),
        text(payload, "url"),
        payload.path("usage_count").asLong(0),
        Timestamps.at(payload, "created_at"),
        Timestamps.at(payload, "updated_at"));
  }

  /**
   * Reads defensively: this also backs the referrers of a
   * {@code media_in_use} refusal, which arrive inside an error body rather than
   * from a route this client trusts to shape exactly right.
   */
  public static MediaUsage toUsage(JsonNode payload) {
    return new MediaUsage(
        text(payload, "media_id"),
        text(payload, "project"),
        text(payload, "env"),
        text(payload, "collection"),
        text(payload, "entry_id"));
  }

  public static List<MediaUsage> toUsages(JsonNode array) {
    List<MediaUsage> usages = new ArrayList<>();
    if (array != null && array.isArray()) {
      array.forEach(item -> usages.add(toUsage(item)));
    }
    return List.copyOf(usages);
  }

  private static String text(JsonNode payload, String field) {
    return JsonValues.text(payload, field);
  }
}
