package in.org.quicko.silo.client.variables;

import com.fasterxml.jackson.databind.JsonNode;
import in.org.quicko.silo.client.transport.JsonValues;
import in.org.quicko.silo.client.transport.Timestamps;
import java.time.Instant;
import java.util.Optional;

/**
 * One {@code {{NAME}}} declaration as one environment sees it.
 *
 * <p>{@code value} is empty when this environment has given the name nothing.
 * That is not the same as {@code ""}, which is a value an operator chose: an
 * unset name leaves its reference standing in the response rather than blanking
 * the text around it. The name itself is never rewritten — it is case-sensitive
 * {@code UPPER_SNAKE} content, not metadata.
 */
public record Variable(
    String name,
    String description,
    Optional<String> value,
    long setIn,
    Instant createdAt,
    Instant updatedAt) {

  public static Variable fromWire(JsonNode payload) {
    JsonNode value = payload.get("value");
    return new Variable(
        JsonValues.text(payload, "name"),
        JsonValues.text(payload, "description"),
        value == null || value.isNull() ? Optional.empty() : Optional.of(value.asText()),
        payload.path("set_in").asLong(0),
        Timestamps.at(payload, "created_at"),
        Timestamps.at(payload, "updated_at"));
  }
}
