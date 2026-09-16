package in.org.quicko.silo.client.collections;

import com.fasterxml.jackson.databind.JsonNode;
import in.org.quicko.silo.client.transport.JsonValues;

/**
 * One collection with its schema, bundled so the {@code silo://} refs inside it
 * are already resolved. What {@code create}, {@code schema().get()},
 * {@code schema().put()} and {@code environment.schemas()} all answer.
 */
public record CollectionDefinition(String id, String name, JsonSchema schema) {

  public static CollectionDefinition fromWire(JsonNode payload) {
    return new CollectionDefinition(
        JsonValues.text(payload, "id"),
        JsonValues.text(payload, "name"),
        JsonSchema.of(payload.get("schema")));
  }
}
