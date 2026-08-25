import type { Context } from "hono";
import { ValidationError } from "@silo/shared/validation-error";
import type { AuthenticatedKey } from "../../core/keys/authenticated-key";
import type { PluginRouteMatch, PluginServeRequest } from "../../plugins";

/**
 * Turns one HTTP request into the JSON a plugin route handler receives (D36,
 * phase 6).
 *
 * Its own artifact because what it *omits* is a decision, not plumbing. A
 * plugin gets a method, the path inside its own namespace, the parameters its
 * declared route bound, the query, the headers it is allowed to see, the body as
 * text, and who is calling. It does not get the request object, the raw URL, or
 * anything that would let it learn where it is mounted — a handler that knew its
 * own prefix would be a handler that could be broken by moving it.
 */
export class ExtRequest {
  /**
   * Headers a plugin never sees.
   *
   * `authorization` and `x-api-key` are the caller's **credential**, and a
   * plugin has no business holding one: it already acts with its own authority,
   * so the only use for a caller's secret is to act as them. That is the same
   * rule from the other direction as `PluginApiDispatcher` stripping these on
   * the way *out* — a plugin neither presents a credential nor receives one, so
   * a compromised or merely careless plugin cannot log or forward a token it
   * was handed. `cookie` goes for the same reason.
   */
  private static readonly Withheld = new Set(["authorization", "x-api-key", "cookie"]);

  /** The maximum request body a plugin route accepts, in bytes.
   *
   *  A bound rather than a stream because the payload crosses a
   *  structured-clone boundary as one value: there is no back-pressure to be
   *  had, so an unbounded body is a way to make the host allocate whatever a
   *  caller sends. Media uploads have their own route and do not come through
   *  here. */
  static readonly MaxBodyBytes = 1024 * 1024;

  static async of(
    c: Context,
    url: URL,
    matched: PluginRouteMatch,
    caller: AuthenticatedKey | undefined
  ): Promise<PluginServeRequest> {
    return {
      method: c.req.method,
      path: matched.route.path,
      params: matched.params,
      query: Object.fromEntries(url.searchParams.entries()),
      headers: ExtRequest.headers(c),
      body: await ExtRequest.body(c),
      // Claims included so a plugin can be stricter than the route's `auth`
      // said; the secret and its hash are not, because there is nothing a
      // plugin could correctly do with them.
      caller: caller
        ? { id: caller.id, label: caller.label, claims: [...caller.claims] }
        : null,
    };
  }

  /** Everything the caller sent except the credentials in `Withheld`, lowercased
   *  so a handler can look one up without knowing how a proxy capitalised it. */
  private static headers(c: Context): Record<string, string> {
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(c.req.header())) {
      const lower = name.toLowerCase();
      if (ExtRequest.Withheld.has(lower)) continue;
      if (typeof value === "string") headers[lower] = value;
    }
    return headers;
  }

  /**
   * Text, or `null` for a request that carried no body.
   *
   * Past `MaxBodyBytes` this **refuses** rather than truncating or quietly
   * passing `null`. Both of those would reach the handler as a smaller request
   * than the one that was sent, and a plugin cannot tell a body it was not given
   * from one that was never there — so the caller would get a 200 describing
   * work that was done on the wrong input.
   */
  private static async body(c: Context): Promise<string | null> {
    if (c.req.method === "GET" || c.req.method === "HEAD") return null;
    const buffer = await c.req.arrayBuffer();
    if (buffer.byteLength === 0) return null;
    if (buffer.byteLength > ExtRequest.MaxBodyBytes) {
      throw new ValidationError(
        `request body is ${buffer.byteLength} bytes; a plugin route accepts at most ` +
          `${ExtRequest.MaxBodyBytes}`
      );
    }
    return new TextDecoder().decode(buffer);
  }
}
