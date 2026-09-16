package in.org.quicko.silo.client.transport;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.List;

/**
 * Reads a list response body. The wire uses {@code data} for entries and search
 * and {@code items} for media, collections and projects — this is the only place
 * in the client that knows both names.
 *
 * <p>{@code limit} and {@code offset} are null when the route echoed no window,
 * which the caller then falls back on the requested one for.
 */
public record PagePayload(List<JsonNode> rows, int total, Integer limit, Integer offset) {

  public static PagePayload read(JsonNode body) {
    JsonNode array = body.has("data") && body.get("data").isArray() ? body.get("data")
        : body.has("items") && body.get("items").isArray() ? body.get("items") : null;

    List<JsonNode> rows = new ArrayList<>();
    if (array != null) array.forEach(rows::add);

    return new PagePayload(
        List.copyOf(rows),
        body.path("total").isNumber() ? body.get("total").asInt() : rows.size(),
        body.path("limit").isNumber() ? body.get("limit").asInt() : null,
        body.path("offset").isNumber() ? body.get("offset").asInt() : null);
  }
}
