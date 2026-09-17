package in.org.quicko.silo.client.scope;

import in.org.quicko.silo.client.collections.CollectionCache;
import in.org.quicko.silo.client.transport.Transport;

/**
 * The transport plus the project and environment names a handle needs to build
 * its own paths — what {@link EnvironmentHandle} passes to everything it
 * constructs, so none of them repeats the same three constructor parameters.
 */
public record ScopeReference(
    Transport transport, String project, String environment, CollectionCache cache) {
  public ScopeReference(Transport transport, String project, String environment) {
    this(transport, project, environment, new CollectionCache(null));
  }
}
