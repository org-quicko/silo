import type { HealthReport } from "./instance/health-report.js";
import { Media } from "./media/media.js";
import type { RequestOptions } from "./request-options.js";
import { ProjectHandle } from "./scope/project-handle.js";
import { Projects } from "./scope/projects.js";
import type { EnvironmentHandle } from "./scope/environment-handle.js";
import { Search } from "./search/search.js";
import type { SearchPage } from "./search/search-page.js";
import type { SearchQuery } from "./search/search-query.js";
import { SearchReach } from "./search/search-reach.js";
import type { SiloOptions } from "./silo-options.js";
import { ApiPath } from "./transport/api-path.js";
import { Transport } from "./transport/transport.js";

/**
 * One silo instance. Navigate it the way the API is shaped:
 * `silo.project("acme").environment("prod").collection<Post>("posts")`.
 *
 * Handles are value objects and make no request, so nothing in a chain needs
 * an `await` until the call at the end. There is deliberately no default
 * project or environment: both names are always given.
 */
export class Silo {
  /** The projects this key can see, and creating one. */
  readonly projects: Projects;
  /** The media catalog. Media is instance-global, so it takes no scope. */
  readonly media: Media;

  private readonly options: SiloOptions;
  private readonly transport: Transport;

  constructor(options: SiloOptions) {
    this.options = options;
    this.transport = new Transport({
      url: options.url,
      key: options.key,
      headers: options.headers,
      timeoutMilliseconds: options.timeoutMilliseconds,
      fetch: options.fetch,
    });
    this.projects = new Projects(this.transport);
    this.media = new Media(this.transport);
  }

  /** One project, by the name every path addresses it with. */
  project(name: string): ProjectHandle {
    return new ProjectHandle(this.transport, name);
  }

  /** `silo.project(p).environment(e)` in one call. Still takes both names. */
  scope(project: string, environment: string): EnvironmentHandle {
    return this.project(project).environment(environment);
  }

  /**
   * Search everything this key can read. The narrower reaches are
   * `environment.search()` and `collection.search()`, so a reach is always
   * the receiver and never an argument that could be forgotten.
   */
  search(query: SearchQuery, options?: RequestOptions): Promise<SearchPage> {
    return new Search(this.transport, SearchReach.instance()).run(query, options);
  }

  /** Liveness and version. The one route that is never authenticated. */
  health(options?: RequestOptions): Promise<HealthReport> {
    return this.transport.json<HealthReport>({
      method: "GET",
      path: ApiPath.health(),
      signal: options?.signal,
      timeoutMilliseconds: options?.timeoutMilliseconds,
    });
  }

  /** The same instance read with a different key. */
  withKey(key: string | undefined): Silo {
    return new Silo({ ...this.options, key });
  }

  /** The same options pointed at a different server. */
  withUrl(url: string): Silo {
    return new Silo({ ...this.options, url });
  }
}
