package in.org.quicko.silo.client.collections;

import com.fasterxml.jackson.databind.JsonNode;
import in.org.quicko.silo.client.RequestOptions;
import in.org.quicko.silo.client.scope.ScopeReference;
import in.org.quicko.silo.client.transport.ApiPath;
import in.org.quicko.silo.client.transport.TransportRequest;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * The collections within one environment: {@code list} answers summaries and no
 * schema, {@code create} answers the new collection's bundled definition.
 *
 * <p>Named {@code CollectionCatalog} rather than the TypeScript client's
 * {@code Collections}, which would collide with {@link java.util.Collections} at
 * every import site that needs both.
 */
public final class CollectionCatalog {
  private final ScopeReference scope;

  public CollectionCatalog(ScopeReference scope) {
    this.scope = scope;
  }

  public List<CollectionSummary> list() {
    return list(RequestOptions.none());
  }

  public List<CollectionSummary> list(RequestOptions options) {
    JsonNode body = scope.transport().json(
        TransportRequest.get(ApiPath.collections(scope.project(), scope.environment()))
            .options(options)
            .build());

    List<CollectionSummary> summaries = new ArrayList<>();
    body.path("items").forEach(item -> summaries.add(CollectionSummary.fromWire(item)));
    return List.copyOf(summaries);
  }

  public CollectionDefinition create(String name, JsonSchema schema) {
    return create(name, schema, RequestOptions.none());
  }

  /**
   * A schema declaring a field named {@code id}, {@code rev}, {@code seq},
   * {@code created_at} or {@code updated_at} is refused by the server with a
   * validation failure naming it, so there is no second copy of that list here.
   */
  public CollectionDefinition create(String name, JsonSchema schema, RequestOptions options) {
    return CollectionDefinition.fromWire(scope.transport().json(
        TransportRequest.post(ApiPath.collections(scope.project(), scope.environment()))
            .body(Map.of("name", name, "schema", schema.document()))
            .options(options)
            .build()));
  }
}
