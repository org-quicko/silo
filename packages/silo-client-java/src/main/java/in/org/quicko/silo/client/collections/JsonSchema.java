package in.org.quicko.silo.client.collections;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import in.org.quicko.silo.client.transport.JsonCodec;
import java.util.Map;

/**
 * A JSON Schema document, held as the tree it is. This client validates nothing
 * locally and passes a schema to the server exactly as given, so there is no
 * typed model of the keywords here — silo owns that rule, and a second copy of
 * it is a second thing to drift.
 */
public final class JsonSchema {
  private static final ObjectMapper Mapper = JsonCodec.defaultMapper();

  private final JsonNode document;

  private JsonSchema(JsonNode document) {
    this.document = document;
  }

  public static JsonSchema of(JsonNode document) {
    return new JsonSchema(document);
  }

  public static JsonSchema of(Map<String, ?> document) {
    return new JsonSchema(Mapper.valueToTree(document));
  }

  /** Reads a schema written as JSON text, which is how most of them arrive. */
  public static JsonSchema parse(String json) {
    try {
      return new JsonSchema(Mapper.readTree(json));
    } catch (com.fasterxml.jackson.core.JsonProcessingException caught) {
      throw new IllegalArgumentException("not a JSON Schema document this client can read", caught);
    }
  }

  /** The tree, which is also what is sent as a request body. */
  public JsonNode document() {
    return document;
  }

  @Override
  public String toString() {
    return document.toString();
  }
}
