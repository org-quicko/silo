import type { Context, MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { HttpConfig } from "../../config/http-config";
import { HttpDefaults } from "../../config/http-defaults";

/**
 * Refuses a request body before any handler sees it, at the ceiling its route
 * class earns (§10.4 in docs/design/configuration.md).
 *
 * Three classes. The upload routes take bytes, stream or spool them, and are
 * bounded by the listener's own `maxRequestBodySize`, so they pass through.
 * A method that carries no body may carry none. Everything else takes a JSON
 * document and gets `[http] max_json_body_size_mb`, checked from
 * `Content-Length` where there is one and by counting where there is not.
 */
export class BodyLimitMiddleware {
  /** The routes whose body is bytes rather than a document. */
  private static readonly Uploads: ReadonlyArray<{ method: string; path: RegExp }> = [
    { method: "POST", path: /^\/api\/media$/ },
    { method: "POST", path: /^\/api\/media\/[^/]+\/content$/ },
    { method: "POST", path: /^\/api\/import$/ },
    { method: "POST", path: /^\/api\/plugins\/install$/ },
  ];

  /** Plugin routes set their own `max_bytes`, enforced by `ExtRequest`. */
  private static readonly Extension = /^\/api\/ext\//;

  private static readonly Bodiless = new Set(["GET", "HEAD", "OPTIONS"]);

  static create(config: HttpConfig): MiddlewareHandler {
    const json = bodyLimit({
      maxSize: HttpDefaults.bytes(config.max_json_body_size_mb),
      onError: (c) =>
        BodyLimitMiddleware.refuse(
          c,
          `request body exceeds ${config.max_json_body_size_mb} MB, the most this route accepts`
        ),
    });
    const none = bodyLimit({
      maxSize: 0,
      onError: (c) => BodyLimitMiddleware.refuse(c, `${c.req.method} takes no request body`),
    });

    return async (c, next) => {
      if (BodyLimitMiddleware.isUpload(c.req.method, c.req.path)) return next();
      if (BodyLimitMiddleware.Bodiless.has(c.req.method)) return none(c, next);
      return json(c, next);
    };
  }

  static isUpload(method: string, path: string): boolean {
    if (BodyLimitMiddleware.Extension.test(path)) return true;
    return BodyLimitMiddleware.Uploads.some(
      (route) => route.method === method && route.path.test(path)
    );
  }

  private static refuse(c: Context, message: string): Response {
    return c.json({ error: { code: "payload_too_large", message } }, 413);
  }
}
