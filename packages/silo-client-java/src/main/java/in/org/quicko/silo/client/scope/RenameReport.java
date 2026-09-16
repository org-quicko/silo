package in.org.quicko.silo.client.scope;

import com.fasterxml.jackson.databind.JsonNode;
import in.org.quicko.silo.client.transport.JsonValues;
import java.util.List;

/**
 * What a rename did, or would do.
 *
 * <p>{@code id} is the record the rename acted on: pass it as
 * {@link RenameOptions#expectedId(String)} to turn a dry run's report into the
 * real call. {@code patternAffectedClaims} are the prefix-pattern claims the
 * rename carries the entity across the edge of — silo rewrites a literal scope
 * segment and reports a pattern rather than rewriting it, so authority never
 * moves silently.
 */
public record RenameReport(
    String id,
    String from,
    String to,
    List<String> rewrittenClaims,
    List<String> patternAffectedClaims) {

  public RenameReport {
    rewrittenClaims = List.copyOf(rewrittenClaims);
    patternAffectedClaims = List.copyOf(patternAffectedClaims);
  }

  public static RenameReport fromWire(JsonNode payload) {
    return new RenameReport(
        payload.path("id").asText(""),
        payload.path("from").asText(""),
        payload.path("to").asText(""),
        JsonValues.strings(payload.get("rewritten_claims")),
        JsonValues.strings(payload.get("pattern_affected_claims")));
  }
}
