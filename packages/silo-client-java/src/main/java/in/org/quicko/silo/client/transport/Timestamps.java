package in.org.quicko.silo.client.transport;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;

/**
 * Reads silo's ISO-8601 timestamps. Accepts the {@code Z} form silo writes and
 * an explicit offset besides, because a timestamp that round-tripped through
 * another writer can carry one and losing the field is worse than parsing it.
 */
public final class Timestamps {
  private Timestamps() {}

  public static Instant parse(String value) {
    if (value == null || value.isEmpty()) return null;
    try {
      return Instant.parse(value);
    } catch (DateTimeParseException caught) {
      return OffsetDateTime.parse(value).toInstant();
    }
  }

  /** The named field of {@code node} as an {@link Instant}, or null. */
  public static Instant at(JsonNode node, String field) {
    JsonNode value = node == null ? null : node.get(field);
    return value == null || !value.isTextual() ? null : parse(value.asText());
  }
}
