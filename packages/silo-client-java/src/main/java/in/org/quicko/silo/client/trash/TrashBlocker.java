package in.org.quicko.silo.client.trash;

import com.fasterxml.jackson.databind.JsonNode;
import in.org.quicko.silo.client.transport.JsonValues;
import java.util.Optional;

/**
 * The container that has to come back first. {@code trashId} is that
 * container's own receipt when it is in the trash too, and empty when it was
 * purged.
 */
public record TrashBlocker(TrashKind kind, String name, Optional<String> trashId) {

  public static TrashBlocker fromWire(JsonNode payload) {
    return new TrashBlocker(
        TrashKind.of(JsonValues.text(payload, "kind")),
        JsonValues.text(payload, "name"),
        Optional.ofNullable(JsonValues.textOrNull(payload, "trash_id")));
  }
}
