package in.org.quicko.silo.client.trash;

import com.fasterxml.jackson.databind.JsonNode;
import in.org.quicko.silo.client.transport.JsonValues;
import in.org.quicko.silo.client.transport.Timestamps;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

/**
 * One explicitly deleted thing. A collection deleted with 300 entries is one of
 * these, not 301.
 *
 * <p>{@code expiresAt} is empty when the instance keeps trash with no time
 * limit. {@code restorable} is false exactly when {@code blockedBy} is present.
 * {@code mediaRefs} are the media ids the parked content refers to.
 */
public record TrashRecord(
    String id,
    TrashKind kind,
    TrashOrigin origin,
    String subjectId,
    String subjectName,
    Instant deletedAt,
    TrashActor deletedBy,
    Optional<Instant> expiresAt,
    TrashContents contents,
    List<String> mediaRefs,
    TrashState state,
    boolean restorable,
    Optional<TrashBlocker> blockedBy) {

  public TrashRecord {
    mediaRefs = List.copyOf(mediaRefs);
  }

  public static TrashRecord fromWire(JsonNode payload) {
    JsonNode blocker = payload.get("blocked_by");
    return new TrashRecord(
        JsonValues.text(payload, "id"),
        TrashKind.of(JsonValues.text(payload, "kind")),
        TrashOrigin.fromWire(payload.path("origin")),
        JsonValues.text(payload, "subject_id"),
        JsonValues.text(payload, "subject_name"),
        Timestamps.at(payload, "deleted_at"),
        TrashActor.fromWire(payload.path("deleted_by")),
        Optional.ofNullable(Timestamps.at(payload, "expires_at")),
        TrashContents.fromWire(payload.path("contents")),
        JsonValues.strings(payload.get("media_refs")),
        TrashState.of(JsonValues.text(payload, "state")),
        payload.path("restorable").asBoolean(false),
        blocker == null || !blocker.isObject()
            ? Optional.empty()
            : Optional.of(TrashBlocker.fromWire(blocker)));
  }
}
