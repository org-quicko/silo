package in.org.quicko.silo.client.instance;

import com.fasterxml.jackson.databind.JsonNode;
import in.org.quicko.silo.client.transport.JsonValues;

/** What the health route answers. It is the one route that is never authenticated. */
public record HealthReport(String status, String version) {

  public static HealthReport fromWire(JsonNode payload) {
    return new HealthReport(
        JsonValues.text(payload, "status"), JsonValues.text(payload, "version"));
  }
}
