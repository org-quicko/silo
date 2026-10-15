package in.org.quicko.silo.client.trash;

import com.fasterxml.jackson.databind.JsonNode;
import in.org.quicko.silo.client.transport.JsonValues;

/**
 * Who deleted it. silo authenticates keys, so "who" is a key.
 *
 * <p>{@code kind} is {@code "key"}, {@code "cli"} or {@code "system"};
 * {@code id} and {@code label} are set for a key only, the label as it was at
 * the time of the delete.
 */
public record TrashActor(String kind, String id, String label) {

  public static TrashActor fromWire(JsonNode payload) {
    return new TrashActor(
        JsonValues.text(payload, "kind"),
        JsonValues.textOrNull(payload, "id"),
        JsonValues.textOrNull(payload, "label"));
  }
}
