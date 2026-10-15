package in.org.quicko.silo.client.trash;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.List;

/**
 * The records one receipt parked, untyped, as the server stores them: each has
 * a {@code kind} and the {@code record} it held. A tree, like
 * {@code JsonSchema}, because the record's shape depends on its kind.
 */
public record TrashParkedRecords(List<JsonNode> records, int total) {

  public TrashParkedRecords {
    records = List.copyOf(records);
  }

  public static TrashParkedRecords fromWire(JsonNode body) {
    List<JsonNode> records = new ArrayList<>();
    body.path("items").forEach(records::add);
    return new TrashParkedRecords(records, body.path("total").asInt(0));
  }
}
