package in.org.quicko.silo.client.media;

import com.fasterxml.jackson.databind.JsonNode;
import in.org.quicko.silo.client.transport.JsonValues;
import java.util.ArrayList;
import java.util.List;

/**
 * What a bulk delete answers, always with a 200: every id's outcome, never a
 * partial result the caller has to infer from a thrown exception.
 */
public record MediaDeleteReport(List<String> deleted, List<MediaDeleteFailure> failed) {

  public MediaDeleteReport {
    deleted = List.copyOf(deleted);
    failed = List.copyOf(failed);
  }

  public static MediaDeleteReport fromWire(JsonNode body) {
    List<MediaDeleteFailure> failures = new ArrayList<>();
    body.path("failed").forEach(failure -> failures.add(MediaDeleteFailure.fromWire(failure)));
    return new MediaDeleteReport(JsonValues.strings(body.get("deleted")), failures);
  }
}
