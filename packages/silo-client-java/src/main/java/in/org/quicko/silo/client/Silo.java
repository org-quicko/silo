package in.org.quicko.silo.client;

import in.org.quicko.silo.client.instance.HealthReport;
import in.org.quicko.silo.client.media.Media;
import in.org.quicko.silo.client.scope.EnvironmentHandle;
import in.org.quicko.silo.client.scope.ProjectHandle;
import in.org.quicko.silo.client.scope.Projects;
import in.org.quicko.silo.client.search.Search;
import in.org.quicko.silo.client.search.SearchPage;
import in.org.quicko.silo.client.search.SearchQuery;
import in.org.quicko.silo.client.search.SearchReach;
import in.org.quicko.silo.client.transport.ApiPath;
import in.org.quicko.silo.client.transport.Transport;
import in.org.quicko.silo.client.transport.TransportOptions;
import in.org.quicko.silo.client.transport.TransportRequest;

/**
 * One silo instance. Navigate it the way the API is shaped:
 * {@code silo.project("acme").environment("prod").collection("posts", Post.class)}.
 *
 * <p>Handles are value objects and make no request, so a chain costs nothing
 * until the call at the end of it. There is deliberately no default project or
 * environment: a client that assumed one would read the wrong environment
 * silently on any instance that has more than one, and silence is the failure
 * mode that costs content.
 *
 * <p>Every call blocks. Java 25 runs them on virtual threads without a thread
 * per call, so an asynchronous surface would be a second API for what the
 * platform already does — which is why there is not one.
 */
public final class Silo {
  private final SiloOptions options;
  private final Transport transport;
  private final Projects projects;
  private final Media media;

  public Silo(SiloOptions options) {
    this.options = options;
    this.transport = new Transport(new TransportOptions(
        options.url(),
        options.key(),
        options.headers(),
        options.timeout(),
        options.httpClient(),
        options.objectMapper()));
    this.projects = new Projects(transport);
    this.media = new Media(transport);
  }

  /** An anonymous client against one instance. */
  public static Silo at(String url) {
    return new Silo(SiloOptions.of(url));
  }

  public static Silo at(String url, String key) {
    return new Silo(SiloOptions.of(url, key));
  }

  /** The projects this key can see, and creating one. */
  public Projects projects() {
    return projects;
  }

  /** The media catalog. Media is instance-global, so it takes no scope. */
  public Media media() {
    return media;
  }

  /** One project, by the name every path addresses it with. */
  public ProjectHandle project(String name) {
    return new ProjectHandle(transport, name);
  }

  /** {@code project(p).environment(e)} in one call. Still takes both names. */
  public EnvironmentHandle scope(String project, String environment) {
    return project(project).environment(environment);
  }

  public SearchPage search(SearchQuery query) {
    return search(query, RequestOptions.none());
  }

  /**
   * Searches everything this key can read. The narrower reaches are
   * {@code environment.search()} and {@code collection.search()}, so a reach is
   * always the receiver and never an argument that could be forgotten.
   */
  public SearchPage search(SearchQuery query, RequestOptions options) {
    return new Search(transport, SearchReach.instance()).run(query, options);
  }

  public HealthReport health() {
    return health(RequestOptions.none());
  }

  /** Liveness and version. The one route that is never authenticated. */
  public HealthReport health(RequestOptions options) {
    return HealthReport.fromWire(
        transport.json(TransportRequest.get(ApiPath.health()).options(options).build()));
  }

  /** The same instance read with a different key. */
  public Silo withKey(String key) {
    return new Silo(options.key(key));
  }

  /** The same options pointed at a different server. */
  public Silo withUrl(String url) {
    return new Silo(options.url(url));
  }
}
