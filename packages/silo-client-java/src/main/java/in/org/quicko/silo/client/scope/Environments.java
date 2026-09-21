package in.org.quicko.silo.client.scope;

import com.fasterxml.jackson.databind.JsonNode;
import in.org.quicko.silo.client.RequestOptions;
import in.org.quicko.silo.client.transport.ApiPath;
import in.org.quicko.silo.client.transport.JsonValues;
import in.org.quicko.silo.client.transport.Transport;
import in.org.quicko.silo.client.transport.TransportRequest;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * The environments within one project: {@code list} and {@code create}. The wire
 * also carries {@code project_id}, which a caller already knows from the handle
 * it called this on, so it is dropped rather than mapped.
 */
public final class Environments {
  private final Transport transport;
  private final String project;

  public Environments(Transport transport, String project) {
    this.transport = transport;
    this.project = project;
  }

  public List<Environment> list() {
    return list(RequestOptions.none());
  }

  public List<Environment> list(RequestOptions options) {
    JsonNode body = transport.json(
        TransportRequest.get(ApiPath.environments(project)).options(options).build());

    List<Environment> environments = new ArrayList<>();
    body.path("items").forEach(item -> environments.add(
        new Environment(JsonValues.text(item, "id"), JsonValues.text(item, "name"))));
    return List.copyOf(environments);
  }

  public Environment create(String name) {
    return create(name, RequestOptions.none());
  }

  public Environment create(String name, RequestOptions options) {
    JsonNode payload = transport.json(
        TransportRequest.post(ApiPath.environments(project))
            .body(Map.of("id", name))
            .options(options)
            .build());
    return new Environment(JsonValues.text(payload, "id"), JsonValues.text(payload, "name"));
  }
}
