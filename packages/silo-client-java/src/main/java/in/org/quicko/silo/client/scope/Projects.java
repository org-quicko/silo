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

/** The projects at the instance root: {@code list} and {@code create}. */
public final class Projects {
  private final Transport transport;

  public Projects(Transport transport) {
    this.transport = transport;
  }

  public List<Project> list() {
    return list(RequestOptions.none());
  }

  public List<Project> list(RequestOptions options) {
    JsonNode body = transport.json(
        TransportRequest.get(ApiPath.projects()).options(options).build());

    List<Project> projects = new ArrayList<>();
    body.path("items").forEach(item ->
        projects.add(new Project(JsonValues.text(item, "id"), JsonValues.text(item, "name"))));
    return List.copyOf(projects);
  }

  public Project create(String name) {
    return create(name, RequestOptions.none());
  }

  /** The create route names the new project in an {@code id} field, which is
   *  the name rather than the ULID it answers back. */
  public Project create(String name, RequestOptions options) {
    JsonNode payload = transport.json(
        TransportRequest.post(ApiPath.projects())
            .body(Map.of("id", name))
            .options(options)
            .build());
    return new Project(JsonValues.text(payload, "id"), JsonValues.text(payload, "name"));
  }
}
