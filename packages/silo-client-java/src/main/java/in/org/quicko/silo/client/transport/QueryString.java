package in.org.quicko.silo.client.transport;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;

/**
 * Builds the {@code ?a=1&b=2} suffix for a request. Omits a null value, renders
 * a {@link JsonNode} (the filter AST) as its compact JSON before encoding it,
 * and answers {@code ""} when nothing is set — so a call site can concatenate
 * the result onto a path unconditionally.
 */
public final class QueryString {
  private QueryString() {}

  public static String build(Map<String, Object> query) {
    if (query == null || query.isEmpty()) return "";

    StringBuilder built = new StringBuilder();
    for (Map.Entry<String, Object> parameter : query.entrySet()) {
      Object value = parameter.getValue();
      if (value == null) continue;
      String encoded = value instanceof JsonNode node ? node.toString() : String.valueOf(value);
      built.append(built.isEmpty() ? '?' : '&')
          .append(ApiPath.segment(parameter.getKey()))
          .append('=')
          .append(ApiPath.segment(encoded));
    }
    return built.toString();
  }
}
