package in.org.quicko.silo.client.trash;

import com.fasterxml.jackson.databind.JsonNode;
import in.org.quicko.silo.client.transport.JsonValues;
import java.util.List;
import java.util.Optional;

/**
 * What a restore put back, and what it could not fix.
 *
 * <p>{@code restored} lists the receipt ids, containers first when a chain was
 * asked for. {@code brokenMediaRefs} are media the content still refers to that
 * the library no longer holds. {@code renamedTo} is the name the subject came
 * back under, when a collision forced a rename.
 */
public record TrashRestoreResult(
    List<String> restored,
    long projects,
    long environments,
    long collections,
    long entries,
    long assets,
    List<String> brokenMediaRefs,
    Optional<String> renamedTo) {

  public TrashRestoreResult {
    restored = List.copyOf(restored);
    brokenMediaRefs = List.copyOf(brokenMediaRefs);
  }

  public static TrashRestoreResult fromWire(JsonNode payload) {
    return new TrashRestoreResult(
        JsonValues.strings(payload.get("restored")),
        payload.path("projects").asLong(0),
        payload.path("environments").asLong(0),
        payload.path("collections").asLong(0),
        payload.path("entries").asLong(0),
        payload.path("assets").asLong(0),
        JsonValues.strings(payload.get("broken_media_refs")),
        Optional.ofNullable(JsonValues.textOrNull(payload, "renamed_to")));
  }
}
