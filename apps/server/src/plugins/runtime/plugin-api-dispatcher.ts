import type { Hono } from "hono";
import type { InjectedPrincipal } from "../../http/auth/injected-principal";
import { InjectedPrincipals } from "../../http/auth/injected-principals";
import { ForbiddenError } from "../../core/errors/forbidden-error";
import { PluginFetchTimeoutError } from "../host/plugin-fetch-timeout-error";
import type { PluginFetchRequest } from "../host/plugin-fetch-request";
import type { PluginFetchResponse } from "../host/plugin-fetch-response";

/**
 * Runs a plugin's request against the **same Hono app** a network request hits
 * (D35).
 *
 * This is phase 3 in one object. `PluginContext` used to hold five entry
 * methods with a hand-rolled claim check each: every route added since was
 * invisible to plugins, and every guard it re-implemented was a second
 * evaluator free to disagree with `RouteAuth`. Dispatching instead means the
 * authorization path *is* `AuthMiddleware` and `RouteAuth`, unchanged and
 * unaware — and a route added in 1.x becomes a plugin capability with no plugin
 * work at all.
 *
 * The app arrives **after** the plugins do. Extensions load in `SiloRuntime` so
 * their hooks can be handed to `SiloService`, and the server is built from that
 * service afterwards, so the reference is attached rather than constructor-
 * injected. A dispatcher nobody attached refuses loudly rather than answering
 * 404, which would read like a missing route instead of a missing wiring.
 */
export class PluginApiDispatcher {
  /**
   * How much of the dispatch budget a call leaves for its own rejection to get
   * home (D37, phase 3's fourth requirement).
   *
   * Without it, a `ctx.fetch` bounded by exactly the remaining budget loses the
   * race to `WorkerHost`'s dispatch timer every time, and the worker is killed
   * for the dispatch running long instead of the plugin being told which call
   * did it. The margin only has to cover one `postMessage` hop.
   */
  static readonly MarginMs = 50;

  /**
   * The origin every dispatched request is resolved against.
   *
   * A base is needed because a bare path cannot be parsed, and a *fictional*
   * one is needed because the answer must not depend on where the instance is
   * listening: a plugin's reach is the route table, not a network location. It
   * is also half of the confinement check — a path that resolves to any other
   * origin was never a path.
   */
  private static readonly Origin = "http://plugin.silo.internal";

  private app: Hono | null = null;

  /** Called once the server exists. The last app wins, and every plugin the
   *  supervisor starts later shares this one dispatcher (D39) — so a plugin
   *  enabled at minute forty reaches the same route table as one loaded at
   *  boot, with no second attach to forget. */
  attach(app: Hono): void {
    this.app = app;
  }

  async dispatch(
    plugin: string,
    request: PluginFetchRequest,
    principal: InjectedPrincipal,
    budgetMs: number
  ): Promise<PluginFetchResponse> {
    const app = this.app;
    if (!app) {
      throw new Error(
        `plugin "${plugin}": ctx.fetch is unavailable — no HTTP surface is attached to this process.`
      );
    }

    const method = (request.method || "GET").toUpperCase();
    const url = PluginApiDispatcher.confine(plugin, request.path);
    const bodyless = method === "GET" || method === "HEAD";

    const init: RequestInit = { method, headers: PluginApiDispatcher.headers(request.headers) };
    // Assigned rather than spread so the body's type stays the wire's
    // `string | Uint8Array` rather than being widened to whatever `RequestInit`
    // will accept — a plugin may not hand us a stream or a form.
    if (!bodyless && request.body !== undefined) {
      (init as { body?: string | Uint8Array }).body = request.body;
    }

    // `Promise.resolve` because Hono types `request` as possibly synchronous,
    // and the deadline below has to race a promise either way.
    const answered = Promise.resolve(app.request(url, init, InjectedPrincipals.env(principal)));
    const response = await PluginApiDispatcher.within(
      answered,
      plugin,
      method,
      url.pathname,
      budgetMs
    );

    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: new Uint8Array(await response.arrayBuffer()),
    };
  }

  /**
   * `/api/` and nothing else (D37, phase 3's second requirement).
   *
   * The two surfaces outside it are the SPA fallback and `/media/{id}`, and
   * both sit outside the auth middleware entirely — so a plugin reaching them
   * would be reaching *unauthenticated* routes carrying an injected principal
   * that nothing reads. `/media/{id}` is the one that matters: it serves bytes
   * to anyone holding an id, which is a media grant nobody made.
   *
   * Resolving against a fixed origin does the work. `..` is normalised away by
   * the URL parser *before* the prefix is tested, and `//example.com/api/x` —
   * a path that is really an authority — lands on another origin and is caught
   * by the first check rather than sailing through the second.
   */
  private static confine(plugin: string, path: string): URL {
    let url: URL;
    try {
      url = new URL(path, PluginApiDispatcher.Origin);
    } catch {
      throw new ForbiddenError(
        `plugin "${plugin}": ctx.fetch was given an unparseable path ${JSON.stringify(path)}`
      );
    }

    if (url.origin !== PluginApiDispatcher.Origin || !url.pathname.startsWith("/api/")) {
      throw new ForbiddenError(
        `plugin "${plugin}": ctx.fetch may only reach /api/ — ${JSON.stringify(path)} is outside it.`
      );
    }
    return url;
  }

  /**
   * The headers a plugin set, minus the ones it must not.
   *
   * A credential header is dropped rather than refused: a client that sets one
   * out of habit is not attacking anything, and it authenticates nothing here
   * — `AuthMiddleware` reads the injected principal first and returns. Dropping
   * it keeps that true even if the middleware's order were ever changed back,
   * which is a guarantee worth holding in two places rather than one.
   */
  private static headers(supplied: Record<string, string> | undefined): Record<string, string> {
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(supplied ?? {})) {
      const lower = name.toLowerCase();
      if (lower === "authorization" || lower === "x-api-key") continue;
      headers[name] = value;
    }
    return headers;
  }

  /**
   * The call's own deadline.
   *
   * Nothing in-process is cancelled when it fires — this bounds what the
   * *plugin* waits for, not what the server does. That is the useful half: the
   * worker stops blocking, the hook receives an error naming the call, and
   * whatever the route was doing finishes into a promise nobody reads.
   */
  private static async within(
    answered: Promise<Response>,
    plugin: string,
    method: string,
    path: string,
    budgetMs: number
  ): Promise<Response> {
    const budget = Math.max(budgetMs - PluginApiDispatcher.MarginMs, 1);

    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new PluginFetchTimeoutError(plugin, method, path, budget)),
        budget
      );
    });

    try {
      return await Promise.race([answered, expired]);
    } finally {
      clearTimeout(timer);
    }
  }
}
