import type { Context } from "hono";
import { Claims } from "@silo/shared/claims";
import { ForbiddenError } from "../../core/errors/forbidden-error";
import { NotFoundError } from "../../core/errors/not-found-error";
import type { PluginServeRequest } from "../../plugins";
import type { PluginSupervisor } from "../../plugins";
import type { PluginRuntime } from "../../plugins";
import { PluginTimeoutError } from "../../plugins";
import { RouteAuth } from "../auth/route-auth";
import { ExtRequest } from "./ext-request";

/**
 * `/api/ext/{name}/*` — the routes plugins contribute (D36, phase 6).
 *
 * **One Hono route for all of them**, matched by silo rather than registered by
 * plugins, and that is the design rather than an implementation shortcut.
 * `RouteManager` documents that registration order is load-bearing for Hono's
 * matcher — `/schema` before `/:id`, `/search` before entries — so a plugin
 * allowed to register patterns would be allowed to break entry reads by
 * accident, and a plugin allowed to register `/api/ext/x/*` would claim every
 * path its namespace will ever have. Here a plugin's routes are **data the host
 * interprets**: they cannot shadow, cannot reorder, and can appear and vanish
 * while the process runs, which is what makes phase 4's enable, disable, revoke
 * and rescan mean the same thing for routes as they already do for hooks.
 *
 * D31 reserved `/api/plugins/` for this and D34 took it back, because management
 * needs that space and the two cannot share it: once `POST /api/plugins/acme/
 * grant` is a verb, a plugin route named `grant` is unroutable and nothing at
 * match time tells them apart.
 *
 * **A handler runs with the plugin's authority, not the caller's.** That is the
 * whole reason `http:route` is a claim and `auth: "public"` is called out
 * separately: reaching a plugin route is reaching whatever that plugin was
 * granted. §13.18 is the long version.
 */
export class ExtRoutes {
  private static readonly Prefix = "/api/ext/";

  static register(app: any, plugins: PluginSupervisor) {
    app.all("/api/ext/*", async (c: Context) => ExtRoutes.serve(c, plugins));
  }

  private static async serve(c: Context, plugins: PluginSupervisor) {
    const url = new URL(c.req.url);
    // Split first, decode per segment — `PluginRouteTable` does the decoding.
    // Decoding the whole path here would let a `%2F` inside a parameter become
    // a separator, which is how one path segment matches two.
    const { name, path } = ExtRoutes.split(url.pathname);

    // Every "no" below is a 404 rather than a more specific code, and
    // deliberately says the same thing: whether a plugin is absent, loaded but
    // ungranted, disabled, or simply declares no routes is the operator's
    // business and not a caller's. `/api/plugins` answers it for whoever holds
    // `plugins:read`.
    const runtime = name.length === 0 ? undefined : plugins.runtime(name);
    if (!runtime || runtime.routes.empty) throw new NotFoundError(ExtRoutes.absent(name, path));

    const matched = runtime.routes.match(c.req.method, path);
    if (matched === null) throw new NotFoundError(ExtRoutes.absent(name, path));
    if (matched === "method") {
      return c.json(
        {
          error: {
            code: "method_not_allowed",
            message: `plugin "${name}" serves "${path}" but not for ${c.req.method}`,
          },
        },
        405
      );
    }

    // Read live, so a revoked `http:route` closes the routes on this request.
    if (!runtime.mayServe()) {
      throw new ForbiddenError(
        `plugin "${name}" is not granted "${Claims.HttpRoute}", so it serves no routes`
      );
    }

    // A public route is the one thing about a plugin route an operator cannot
    // infer, so it is declared per route and approved with the rest.
    const caller = matched.route.auth === "public" ? c.get("keyInfo") : RouteAuth.requireKey(c);

    ExtRoutes.refuseReentry(c, runtime);

    const request = await ExtRequest.of(c, url, matched, caller);
    return await ExtRoutes.answer(c, runtime, request, matched.route.method + " " + matched.route.path);
  }

  /**
   * Dispatch into the worker and turn the answer into a response.
   *
   * A plugin throw arrives here already rehydrated by `PluginError.fromWire`, so
   * a handler that throws `ValidationError` or `ForbiddenError` produces a 400
   * or a 403 through `SiloServer.onError` without ever knowing what a status
   * code is — the same mapping a hook's refusal gets (§13.9). Only the timeout
   * is caught, because it is the one failure whose meaning is *about the
   * transport*: the plugin did not answer, and it is now dead until an operator
   * restarts it.
   */
  private static async answer(
    c: Context,
    runtime: PluginRuntime,
    request: PluginServeRequest,
    key: string
  ) {
    let response;
    try {
      response = await runtime.serve(key, request);
    } catch (caught) {
      if (caught instanceof PluginTimeoutError) {
        return c.json(
          {
            error: {
              code: "plugin_unavailable",
              message: caught.message,
              details: {
                plugin: runtime.name,
                remedy: `POST /api/plugins/${runtime.name}/restart`,
              },
            },
          },
          504
        );
      }
      throw caught;
    }

    // 204 means no body, and sending one anyway is the kind of response that
    // makes a client library disagree with a proxy. A HEAD is the same rule from
    // the other end: the handler ran as the GET it declared, and the content it
    // produced is dropped here rather than in the plugin, so a handler never has
    // to know which of the two it is answering.
    if (response.body === null || response.status === 204 || c.req.method === "HEAD") {
      return c.body(null, response.status as any, response.headers);
    }
    return c.body(response.body, response.status as any, response.headers);
  }

  /**
   * Refuse a request that would re-enter a plugin already in the causal chain
   * (D33, D36).
   *
   * `ctx.fetch` is confined to `/api/`, and `/api/ext/` is inside it — so a
   * plugin can reach its own route, and without this a one-line handler that
   * calls itself is an unbounded recursion. The fix is not a new counter: it is
   * the fact `HookBus.shouldDispatch` already reads. A plugin in the chain is
   * one whose own work caused this request, and re-entering it is exactly what
   * D33 made unrepresentable for hooks. Refused rather than skipped, because a
   * request must answer something and a silent 200 with no handler run would be
   * a lie.
   *
   * Plugin-to-plugin calls are untouched: only a *cycle* has the target already
   * in the chain.
   */
  private static refuseReentry(c: Context, runtime: PluginRuntime): void {
    const chain = RouteAuth.getWriteContext(c).chain;
    if (!chain.includes(runtime.name)) return;
    throw new ForbiddenError(
      `plugin "${runtime.name}" cannot call its own route from inside its own work ` +
        `(${[...chain, runtime.name].join(" -> ")})`
    );
  }

  /**
   * `/api/ext/acme/thing` → `{ name: "acme", path: "/thing" }`. A bare
   * `/api/ext/acme` addresses the plugin's own root, which is `"/"`.
   *
   * The name is decoded and the path is not: the name is one segment being
   * compared to a plugin's name, while the path still has to be split before any
   * of it is decoded.
   */
  private static split(pathname: string): { name: string; path: string } {
    const rest = pathname.slice(ExtRoutes.Prefix.length);
    const slash = rest.indexOf("/");
    const raw = slash < 0 ? rest : rest.slice(0, slash);
    let name = raw;
    try {
      name = decodeURIComponent(raw);
    } catch {
      // A malformed escape is not a plugin name, and `plugins.runtime` will say
      // so — there is nothing better to report from here.
    }
    return { name, path: slash < 0 ? "/" : rest.slice(slash) };
  }

  private static absent(name: string, path: string): string {
    return `no plugin route ${name.length === 0 ? path : `"${name}${path}"`}`;
  }
}
