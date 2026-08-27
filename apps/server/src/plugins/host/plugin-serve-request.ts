/**
 * Who is calling a plugin route, as much of it as a plugin may know.
 *
 * `null` on a `public` route reached without a credential. The claims are
 * included because a plugin route runs with the **plugin's** authority and not
 * the caller's, so a plugin that wants to be stricter than "any key" has to be
 * able to look — there is no route-level claim to declare instead, and inventing
 * one would put the same decision in two places.
 *
 * The key's `id` and `label` are here and its `hash` and `prefix` are not: a
 * plugin has no use for a credential's material, and `PluginContext` already
 * treats the secret as the host's business.
 */
export interface PluginRequestCaller {
  id: string;
  label: string;
  claims: readonly string[];
}

/**
 * One HTTP request, flattened into plain JSON for the worker (D36, phase 6).
 *
 * Plain because it crosses a structured-clone boundary, and flattened for the
 * same reason `PluginFetchRequest` is: a request that is a method, a path, some
 * strings and bytes survives a `Worker` today and a subprocess or a WASM guest
 * later without a plugin's source changing.
 */
export interface PluginServeRequest {
  method: string;

  /** The path **inside** the plugin's namespace — what `/api/ext/{name}` was
   *  stripped from — so a plugin never has to know its own mount point. */
  path: string;

  /** Bound from the declared route's `:name` segments. */
  params: Record<string, string>;

  /** Repeated keys keep their last value, which is what `URLSearchParams.get`
   *  would have answered anyway. */
  query: Record<string, string>;

  headers: Record<string, string>;

  /**
   * Text, or `null` — for a request that carried no body, **or** for a route
   * that declared `body.kind: "bytes"`. A plugin parses it: guessing from
   * `content-type` here would make the host responsible for a decision only the
   * route knows the answer to.
   */
  body: string | null;

  /**
   * The raw bytes, or `null` — on a route that declared `body.kind: "bytes"`
   * (D41).
   *
   * Two fields, exactly one of them ever non-null, rather than one field of a
   * union type. The union reads better and travels worse: a handler written
   * against it has to narrow before it can do anything, and the narrowing is on a
   * value that already crossed a structured-clone boundary — where a `string` and
   * a `Uint8Array` are the same kind of plain data and nothing but the route's own
   * declaration distinguishes them. Two nullable fields say which one the route
   * asked for in the shape itself.
   *
   * A `Uint8Array` survives structured clone, so this needs nothing of the
   * transport that `body` did not already need.
   */
  bytes: Uint8Array | null;

  caller: PluginRequestCaller | null;
}
