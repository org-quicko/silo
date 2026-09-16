package in.org.quicko.silo.client.transport;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JavaType;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.json.JsonMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * The one place JSON is read and written. Wraps the {@link ObjectMapper} a
 * caller may supply through {@code SiloOptions}, so a consumer whose field types
 * need a Jackson module registers it once and every read of their content sees it.
 *
 * <p>The default mapper ignores unknown properties: silo adds fields to its
 * responses, and a client that refuses one breaks on a server upgrade it did not
 * need to care about.
 */
public final class JsonCodec {
  private final ObjectMapper mapper;

  public JsonCodec(ObjectMapper mapper) {
    this.mapper = mapper;
  }

  public static ObjectMapper defaultMapper() {
    return JsonMapper.builder()
        .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
        .build();
  }

  public ObjectMapper mapper() {
    return mapper;
  }

  /** Serialises a request body. */
  public String write(Object value) {
    try {
      return mapper.writeValueAsString(value);
    } catch (JsonProcessingException caught) {
      throw new IllegalArgumentException("could not serialise a request body to JSON", caught);
    }
  }

  /** Parses a response body, answering null for an empty one. */
  public JsonNode tree(String raw) {
    if (raw == null || raw.isBlank()) return null;
    try {
      return mapper.readTree(raw);
    } catch (JsonProcessingException caught) {
      throw new IllegalStateException("could not parse a JSON response body", caught);
    }
  }

  /** Parses a body that may not be JSON at all, answering null when it is not. */
  public JsonNode treeOrNull(String raw) {
    try {
      return tree(raw);
    } catch (RuntimeException caught) {
      return null;
    }
  }

  public <T> T convert(JsonNode node, Class<T> type) {
    return mapper.convertValue(node, type);
  }

  public <T> T convert(JsonNode node, TypeReference<T> type) {
    return mapper.convertValue(node, type);
  }

  public <T> T convert(JsonNode node, JavaType type) {
    return mapper.convertValue(node, type);
  }

  public JsonNode toNode(Object value) {
    return mapper.valueToTree(value);
  }

  public ObjectNode object() {
    return mapper.createObjectNode();
  }

  public JavaType typeOf(Class<?> type) {
    return mapper.getTypeFactory().constructType(type);
  }

  public JavaType typeOf(TypeReference<?> type) {
    return mapper.getTypeFactory().constructType(type);
  }
}
