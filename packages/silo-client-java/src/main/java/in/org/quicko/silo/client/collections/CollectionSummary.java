package in.org.quicko.silo.client.collections;

import com.fasterxml.jackson.databind.JsonNode;
import in.org.quicko.silo.client.transport.JsonValues;
import in.org.quicko.silo.client.transport.Timestamps;
import java.time.Instant;

/**
 * One collection as the listing answers it: no schema, which is the one thing a
 * list of collections never needs to draw.
 */
public record CollectionSummary(
    String id,
    String name,
    long entries,
    boolean requiresAuth,
    Instant createdAt,
    Instant updatedAt) {

  public static CollectionSummary fromWire(JsonNode payload) {
    return new CollectionSummary(
        JsonValues.text(payload, "id"),
        JsonValues.text(payload, "name"),
        payload.path("entries").asLong(0),
        payload.path("requires_auth").asBoolean(false),
        Timestamps.at(payload, "created_at"),
        Timestamps.at(payload, "updated_at"));
  }
}
