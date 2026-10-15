package in.org.quicko.silo.client.trash;

import com.fasterxml.jackson.databind.JsonNode;
import in.org.quicko.silo.client.transport.JsonValues;

/**
 * Where the thing was. A restore anchors on the ids; the names can be stale.
 * A field is null when the kind has no such container, and {@code folder} is
 * set for media only.
 */
public record TrashOrigin(
    String projectId,
    String projectName,
    String environmentId,
    String environmentName,
    String collectionId,
    String collectionName,
    String folder) {

  public static TrashOrigin fromWire(JsonNode payload) {
    return new TrashOrigin(
        JsonValues.textOrNull(payload, "project_id"),
        JsonValues.textOrNull(payload, "project_name"),
        JsonValues.textOrNull(payload, "env_id"),
        JsonValues.textOrNull(payload, "env_name"),
        JsonValues.textOrNull(payload, "collection_id"),
        JsonValues.textOrNull(payload, "collection_name"),
        JsonValues.textOrNull(payload, "folder"));
  }
}
