package in.org.quicko.silo.client.variables;

import com.fasterxml.jackson.databind.JsonNode;
import in.org.quicko.silo.client.RequestOptions;
import in.org.quicko.silo.client.scope.ScopeReference;
import in.org.quicko.silo.client.transport.ApiPath;
import in.org.quicko.silo.client.transport.TransportRequest;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * This environment's values: {@code list}, {@code set}, {@code unset}. Declaring,
 * renaming and undeclaring a name are project-wide and live on
 * {@link ProjectVariables}.
 */
public final class EnvironmentVariables {
  private final ScopeReference scope;

  public EnvironmentVariables(ScopeReference scope) {
    this.scope = scope;
  }

  public List<Variable> list() {
    return list(RequestOptions.none());
  }

  public List<Variable> list(RequestOptions options) {
    JsonNode body = scope.transport().json(
        TransportRequest.get(ApiPath.environmentVariables(scope.project(), scope.environment()))
            .options(options)
            .build());

    List<Variable> variables = new ArrayList<>();
    body.path("items").forEach(item -> variables.add(Variable.fromWire(item)));
    return List.copyOf(variables);
  }

  public Variable set(String name, String value) {
    return set(name, value, RequestOptions.none());
  }

  public Variable set(String name, String value, RequestOptions options) {
    return Variable.fromWire(scope.transport().json(
        TransportRequest.put(
                ApiPath.environmentVariable(scope.project(), scope.environment(), name))
            .body(Map.of("value", value))
            .options(options)
            .build()));
  }

  public Variable unset(String name) {
    return unset(name, RequestOptions.none());
  }

  /** Clears this environment's value, leaving the name declared — so the server
   *  answers the updated declaration rather than a 204. */
  public Variable unset(String name, RequestOptions options) {
    return Variable.fromWire(scope.transport().json(
        TransportRequest.delete(
                ApiPath.environmentVariable(scope.project(), scope.environment(), name))
            .options(options)
            .build()));
  }
}
