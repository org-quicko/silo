/**
 * One request a plugin makes through `ctx.fetch` (D35).
 *
 * A method, a path, headers and bytes — which is all a request is, and all that
 * `structuredClone` needs to carry it across the worker boundary. That the
 * shape is trivially serializable is not a happy accident: it is the property
 * that lets the same client run out-of-process, or against a remote silo over a
 * real socket, without a plugin's source changing.
 *
 * There is deliberately no field for a credential. Identity is attached
 * host-side from the grant (`InjectedPrincipal`), so an `Authorization` header
 * set here reaches the route as an ordinary header and authenticates nothing.
 */
export interface PluginFetchRequest {
  method: string;
  /** An absolute path under `/api/`, query string included. Anything else is
   *  refused by `PluginApiDispatcher` — see its `confine`. */
  path: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
}
