package in.org.quicko.silo.client.variables;

import in.org.quicko.silo.client.transport.ApiPath;
import in.org.quicko.silo.client.transport.Transport;
import in.org.quicko.silo.client.transport.TransportRequest;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * The declarations within one project: {@code declare}, {@code rename},
 * {@code describe}, {@code undeclare}. Values live on
 * {@link EnvironmentVariables} instead, because a name is declared once and
 * valued per environment.
 */
public final class ProjectVariables {
  private final Transport transport;
  private final String project;

  public ProjectVariables(Transport transport, String project) {
    this.transport = transport;
    this.project = project;
  }

  public Variable declare(String name) {
    return declare(name, DeclareVariableOptions.none());
  }

  public Variable declare(String name, DeclareVariableOptions options) {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("name", name);
    if (options.description() != null) body.put("description", options.description());
    if (options.value() != null) body.put("value", options.value());

    return Variable.fromWire(transport.json(
        TransportRequest.post(ApiPath.projectVariables(project))
            .query("env", options.environment())
            .body(body)
            .options(options.request())
            .build()));
  }

  public Variable rename(String name, String newName) {
    return rename(name, newName, VariableEnvironmentOptions.none());
  }

  public Variable rename(String name, String newName, VariableEnvironmentOptions options) {
    return updateDeclaration(name, Map.of("name", newName), options);
  }

  public Variable describe(String name, String description) {
    return describe(name, description, VariableEnvironmentOptions.none());
  }

  public Variable describe(String name, String description, VariableEnvironmentOptions options) {
    return updateDeclaration(name, Map.of("description", description), options);
  }

  public void undeclare(String name) {
    undeclare(name, VariableEnvironmentOptions.none());
  }

  /** Forgets the name, and every environment's value with it. */
  public void undeclare(String name, VariableEnvironmentOptions options) {
    transport.empty(
        TransportRequest.delete(ApiPath.projectVariable(project, name))
            .query("env", options.environment())
            .options(options.request())
            .build());
  }

  private Variable updateDeclaration(
      String name, Map<String, Object> body, VariableEnvironmentOptions options) {
    return Variable.fromWire(transport.json(
        TransportRequest.patch(ApiPath.projectVariable(project, name))
            .query("env", options.environment())
            .body(body)
            .options(options.request())
            .build()));
  }
}
