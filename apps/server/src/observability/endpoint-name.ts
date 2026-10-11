/** The scope a named series belongs to, which decides who may see its names. */
export interface EndpointScope {
  project: string;
  env?: string;
  collection?: string;
}

/** How one request is filed: the name it is shown under, the pattern behind it, and its scope. */
export interface EndpointFiling {
  route: string;
  pattern: string;
  scope?: EndpointScope;
}

/**
 * The series a request is counted in (D99).
 *
 * The registered route pattern, with the project, environment and collection
 * filled in and every other parameter left as it is: `…/collections/posts/:id`,
 * never an entry, media or key id, which would make each request its own row.
 * Names are filled in only for a request that succeeded, so a path of made-up
 * names can never take one of the bounded series; a failure is filed under its
 * pattern, and an unmatched path under the catch-all.
 */
export class EndpointName {
  static readonly CatchAll = "/api/*";

  static of(pattern: string, params: Record<string, string>, status: number): EndpointFiling {
    const registered = pattern === "" || pattern === "/*" ? EndpointName.CatchAll : pattern;
    if (registered === EndpointName.CatchAll || status >= 400) return { route: registered, pattern: registered };

    const scope: Partial<EndpointScope> = {};
    const segments = registered.split("/");
    const named = segments.map((segment, index) => {
      if (segment === ":project" && params.project) return (scope.project = params.project);
      if (segment === ":env" && params.env) return (scope.env = params.env);
      // `:name` is a collection only under `collections/`; elsewhere it is a plugin.
      if (segment === ":name" && segments[index - 1] === "collections" && params.name) {
        return (scope.collection = params.name);
      }
      return segment;
    });
    if (scope.project === undefined) return { route: registered, pattern: registered };
    return { route: named.join("/"), pattern: registered, scope: scope as EndpointScope };
  }
}
