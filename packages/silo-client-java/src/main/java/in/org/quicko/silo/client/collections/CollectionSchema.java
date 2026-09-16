package in.org.quicko.silo.client.collections;

import in.org.quicko.silo.client.RequestOptions;
import in.org.quicko.silo.client.scope.DeleteOptions;
import in.org.quicko.silo.client.scope.ScopeReference;
import in.org.quicko.silo.client.transport.ApiPath;
import in.org.quicko.silo.client.transport.TransportRequest;

/**
 * One collection's schema, bundled on every read.
 *
 * <p>Deleting the schema deletes the collection: that is the only path the
 * server exposes for it, which is why {@code delete} lives here rather than on
 * the handle.
 */
public final class CollectionSchema {
  private final ScopeReference scope;
  private final String name;

  public CollectionSchema(ScopeReference scope, String name) {
    this.scope = scope;
    this.name = name;
  }

  public CollectionDefinition get() {
    return get(RequestOptions.none());
  }

  public CollectionDefinition get(RequestOptions options) {
    return CollectionDefinition.fromWire(scope.transport().json(
        TransportRequest.get(path()).options(options).build()));
  }

  public CollectionDefinition put(JsonSchema schema) {
    return put(schema, RequestOptions.none());
  }

  public CollectionDefinition put(JsonSchema schema, RequestOptions options) {
    return CollectionDefinition.fromWire(scope.transport().json(
        TransportRequest.put(path()).body(schema.document()).options(options).build()));
  }

  /** Deletes the schema, and the collection with it. */
  public void delete() {
    delete(DeleteOptions.none());
  }

  public void delete(DeleteOptions options) {
    scope.transport().empty(
        TransportRequest.delete(path())
            .query("force", options.force() ? true : null)
            .options(options.request())
            .build());
  }

  private String path() {
    return ApiPath.collectionSchema(scope.project(), scope.environment(), name);
  }
}
