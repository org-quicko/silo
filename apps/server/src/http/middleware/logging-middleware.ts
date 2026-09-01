import type { Context, Next } from "hono";
import { InjectedPrincipals } from "../auth/injected-principals";
import type { Logger } from "../../logging/logger";
import type { Observability } from "../../observability";

/**
 * One log line per request: method, path, status, and how long it took.
 *
 * Always installed since D47, and asks the logger *per request* whether to
 * write. It used to be installed only when `[log] requests` was on, which made
 * the switch a boot-time decision — an operator who needed an access log to
 * diagnose something in progress had to restart the server and lose the thing
 * they were diagnosing.
 */
export class LoggingMiddleware {
  static create(logger: Logger, observability?: Observability) {
    return async (c: Context, next: Next) => {
      const observe = observability !== undefined && c.req.path.startsWith("/api/");
      if (!logger.requests && !observe) return await next();

      const start = performance.now();
      await next();

      const durationMs = Math.max(0, performance.now() - start);

      /**
       * Which plugin, when a plugin is what made the request (D35).
       *
       * Since phase 3 a `ctx` call is a real request through this middleware, so
       * an access log now contains lines no client sent — and without the name,
       * an operator reading one sees traffic from nobody. It is the same
       * question the log already answers for a key by way of the path it
       * touched, asked of a caller that has no socket.
       */
      const plugin = InjectedPrincipals.of(c)?.key.owner?.name;

      if (observe) {
        // `routePath` is the registered Hono pattern, not the requested path:
        // `/entries/01ABC…` and `/entries/01XYZ…` therefore share one bounded
        // series, and neither id reaches whoever reads the metrics. The API
        // catch-all is named as such rather than exposing the unmatched path.
        const matched = c.req.routePath;
        observability.record({
          completedAt: Date.now(),
          method: c.req.method,
          route: matched === "/*" || matched === "" ? "/api/*" : matched,
          status: c.res.status,
          durationMs,
          internal: plugin !== undefined,
        });
      }

      if (logger.requests) {
        logger.info("request", {
          method: c.req.method,
          path: c.req.path,
          status: c.res.status,
          ms: Math.round(durationMs),
          ...(plugin ? { plugin } : {}),
        });
      }
    };
  }
}
