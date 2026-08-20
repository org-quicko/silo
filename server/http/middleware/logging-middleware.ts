import type { Context, Next } from "hono";
import type { Logger } from "../../logging/logger";

/** One log line per request: method, path, status, and how long it took. */
export class LoggingMiddleware {
  static create(logger: Logger) {
    return async (c: Context, next: Next) => {
      const start = Date.now();
      await next();
      logger.info("request", {
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        ms: Date.now() - start,
      });
    };
  }
}
