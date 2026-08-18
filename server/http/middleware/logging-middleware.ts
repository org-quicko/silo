import type { Context, Next } from "hono";

/** Request logger matching the original Go server's log line shape. */
export class LoggingMiddleware {
  static create() {
    return async (c: Context, next: Next) => {
      const start = Date.now();
      await next();
      const duration = Date.now() - start;
      console.log(
        `${c.req.method} ${c.req.path} -> ${c.res.status} (${duration}ms)`
      );
    };
  }
}
