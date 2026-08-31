import type { Context, Next } from "hono";
import { InjectedPrincipals } from "../auth/injected-principals";
import type { Logger } from "../../logging/logger";

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
  static create(logger: Logger) {
    return async (c: Context, next: Next) => {
      if (!logger.requests) return await next();

      const start = Date.now();
      await next();

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

      logger.info("request", {
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        ms: Date.now() - start,
        ...(plugin ? { plugin } : {}),
      });
    };
  }
}
