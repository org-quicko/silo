import type { Context, Next } from "hono";
import type { AuthenticatedKey } from "../../core/keys/authenticated-key";
import { InjectedPrincipals } from "../auth/injected-principals";
import type { Logger } from "../../logging/logger";
import type { Observability } from "../../observability";
import { EndpointName } from "../../observability/endpoint-name";

/**
 * One log line per request: method, path, status, how long it took, and the
 * key or plugin that made it.
 *
 * Always installed since D47, and asks the logger *per request* whether to
 * write. It used to be installed only when `[log] requests` was on, which made
 * the switch a boot-time decision — an operator who needed an access log to
 * diagnose something in progress had to restart the server and lose the thing
 * they were diagnosing.
 *
 * The log carries the exact path; the metrics never do. `EndpointName` files a
 * request under its route pattern with scope names filled in (D99), so an id
 * never becomes a series and a made-up path never takes one.
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
        // After `next`, the matched route's pattern and parameters, not this middleware's.
        const filed = EndpointName.of(c.req.routePath, c.req.param(), c.res.status);
        observability.record({
          completedAt: Date.now(),
          method: c.req.method,
          route: filed.route,
          pattern: filed.pattern,
          scope: filed.scope,
          status: c.res.status,
          durationMs,
          internal: plugin !== undefined,
        });
      }

      if (logger.requests) {
        // The label and id, never the secret or its hash. A request with no key has neither.
        const key = plugin ? undefined : (c.get("keyInfo") as AuthenticatedKey | undefined);
        logger.info("request", {
          method: c.req.method,
          path: c.req.path,
          status: c.res.status,
          ms: Math.round(durationMs),
          ...(plugin ? { plugin } : {}),
          ...(key ? { key: key.label } : {}),
          // Empty for the auth-disabled principal, which is no stored key.
          ...(key?.id ? { key_id: key.id } : {}),
        });
      }
    };
  }
}
