package in.org.quicko.silo.client.transport;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.List;

/** Reading a field off a wire body without a null check at every call site. */
public final class JsonValues {
  private JsonValues() {}

  /** The named field as text, or {@code ""} when it is absent or null. */
  public static String text(JsonNode node, String field) {
    JsonNode value = node == null ? null : node.get(field);
    return value == null || value.isNull() ? "" : value.asText();
  }

  /** A string array as a list, or an empty list when it is absent. */
  public static List<String> strings(JsonNode array) {
    List<String> values = new ArrayList<>();
    if (array != null && array.isArray()) {
      array.forEach(item -> values.add(item.asText()));
    }
    return List.copyOf(values);
  }
}
