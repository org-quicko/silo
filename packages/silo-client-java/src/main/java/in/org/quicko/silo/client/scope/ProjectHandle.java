package in.org.quicko.silo.client.scope;

import in.org.quicko.silo.client.collections.CollectionCache;
import in.org.quicko.silo.client.transport.ApiPath;
import in.org.quicko.silo.client.transport.Transport;
import in.org.quicko.silo.client.transport.TransportRequest;
import in.org.quicko.silo.client.variables.ProjectVariables;
import java.util.Map;

/**
 * One project, addressed by the name it was built with.
 *
 * <p>Immutable: after a rename this handle still addresses the name that no
 * longer exists, and its next call raises
 * {@link in.org.quicko.silo.client.errors.NotFoundException}. That reads as a
 * rough edge until you consider the alternative, which is a handle whose meaning
 * changes under a caller holding it. Build a new handle for the new name.
 */
public final class ProjectHandle {
  private final Transport transport;
  private final String name;
  private final Environments environments;
  private final ProjectVariables variables;
  private final CollectionCache cache;

  public ProjectHandle(Transport transport, String name) {
    this(transport, name, new CollectionCache(null));
  }

  public ProjectHandle(Transport transport, String name, CollectionCache cache) {
    this.transport = transport;
    this.cache = cache;
    this.name = name;
    this.environments = new Environments(transport, name);
    this.variables = new ProjectVariables(transport, name);
  }

  public String name() {
    return name;
  }

  /** The environments this key can see in the project, and creating one. */
  public Environments environments() {
    return environments;
  }

  /** The {@code {{NAME}}} declarations, which are project-wide. */
  public ProjectVariables variables() {
    return variables;
  }

  public EnvironmentHandle environment(String environmentName) {
    return new EnvironmentHandle(new ScopeReference(transport, name, environmentName, cache));
  }

  public RenameReport rename(String newName) {
    return rename(newName, RenameOptions.none());
  }

  public RenameReport rename(String newName, RenameOptions options) {
    return RenameReport.fromWire(transport.json(
        TransportRequest.patch(ApiPath.project(name))
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
    transport.empty(
        TransportRequest.delete(ApiPath.project(name))
            .query("force", options.force() ? true : null)
            .options(options.request())
            .build());
  }
}
