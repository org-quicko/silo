package in.org.quicko.silo.client.scope;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JavaType;
import com.fasterxml.jackson.databind.JsonNode;
import in.org.quicko.silo.client.RequestOptions;
import in.org.quicko.silo.client.collections.CollectionCatalog;
import in.org.quicko.silo.client.collections.CollectionDefinition;
import in.org.quicko.silo.client.collections.CollectionHandle;
import in.org.quicko.silo.client.search.Search;
import in.org.quicko.silo.client.search.SearchPage;
import in.org.quicko.silo.client.search.SearchQuery;
import in.org.quicko.silo.client.search.SearchReach;
import in.org.quicko.silo.client.transport.ApiPath;
import in.org.quicko.silo.client.transport.TransportRequest;
import in.org.quicko.silo.client.variables.EnvironmentVariables;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * One environment, addressed by the name it was built with. Immutable, for the
 * reason {@link ProjectHandle} is.
 */
public final class EnvironmentHandle {
  private final ScopeReference scope;
  private final CollectionCatalog collections;
  private final EnvironmentVariables variables;

  public EnvironmentHandle(ScopeReference scope) {
    this.scope = scope;
    this.collections = new CollectionCatalog(scope);
    this.variables = new EnvironmentVariables(scope);
  }

  public String name() {
    return scope.environment();
  }

  public String project() {
    return scope.project();
  }

  /** The collections in this environment, and creating one. */
  public CollectionCatalog collections() {
    return collections;
  }

  /** This environment's variable values. */
  public EnvironmentVariables variables() {
    return variables;
  }

  /** An untyped collection, whose entries carry their fields as a map. */
  public CollectionHandle<Map<String, Object>> collection(String name) {
    return collection(name, new TypeReference<Map<String, Object>>() { });
  }

  /** A collection typed to the class its entries deserialise into. */
  public <F> CollectionHandle<F> collection(String name, Class<F> fieldsType) {
    return new CollectionHandle<>(scope, name, scope.transport().codec().typeOf(fieldsType));
  }

  /** A collection whose field type is generic, named by a {@link TypeReference}. */
  public <F> CollectionHandle<F> collection(String name, TypeReference<F> fieldsType) {
    JavaType resolved = scope.transport().codec().typeOf(fieldsType);
    return new CollectionHandle<>(scope, name, resolved);
  }

  public List<CollectionDefinition> schemas() {
    return schemas(RequestOptions.none());
  }

  /** Every schema in the scope, in one request. */
  public List<CollectionDefinition> schemas(RequestOptions options) {
    JsonNode body = scope.transport().json(
        TransportRequest.get(ApiPath.schemas(scope.project(), scope.environment()))
            .options(options)
            .build());

    List<CollectionDefinition> definitions = new ArrayList<>();
    body.path("items").forEach(item -> definitions.add(CollectionDefinition.fromWire(item)));
    return List.copyOf(definitions);
  }

  public SearchPage search(SearchQuery query) {
    return search(query, RequestOptions.none());
  }

  /** Searches every collection in this environment that the key can read. */
  public SearchPage search(SearchQuery query, RequestOptions options) {
    return new Search(
            scope.transport(), SearchReach.environment(scope.project(), scope.environment()))
        .run(query, options);
  }

  public RenameReport rename(String newName) {
    return rename(newName, RenameOptions.none());
  }

  public RenameReport rename(String newName, RenameOptions options) {
    return RenameReport.fromWire(scope.transport().json(
        TransportRequest.patch(ApiPath.environment(scope.project(), scope.environment()))
            .query("dry_run", options.dryRun() ? true : null)
            .query("expected_id", options.expectedId())
            .body(Map.of("name", newName))
            .options(options.request())
            .build()));
  }

  public void delete() {
    delete(DeleteOptions.none());
  }

  public void delete(DeleteOptions options) {
    scope.transport().empty(
        TransportRequest.delete(ApiPath.environment(scope.project(), scope.environment()))
            .query("force", options.force() ? true : null)
            .options(options.request())
            .build());
  }
}
