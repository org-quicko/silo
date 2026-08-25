import { Hono } from "hono";
import { cors } from "hono/cors";
import type { SiloService } from "../core/services/silo-service";
import { RouteManager } from "./routes/route-manager";
import { LoggingMiddleware } from "./middleware/logging-middleware";
import { AuthMiddleware } from "./middleware/auth-middleware";
import { ValidationError } from "@silo/shared/validation-error";
import { NotFoundError } from "../core/errors/not-found-error";
import { ConflictError } from "../core/errors/conflict-error";
import { MediaDeleteStalledError } from "../core/errors/media-delete-stalled-error";
import { UnauthorizedError } from "../core/errors/unauthorized-error";
import { ForbiddenError } from "../core/errors/forbidden-error";
import type { Logger } from "../logging/logger";
import { UiAssets } from "./ui-assets";

/** How to build the app. An options object rather than a fourth and fifth
 *  positional argument, two of which would be bare booleans. */
export interface SiloServerOptions {
  version: string;
  authDisabled: boolean;
  logger: Logger;
  /** Whether to log a line per request. Off unless asked for, so a test or an
   *  embedder does not have to opt out of an access log it never wanted. */
  logRequests?: boolean;
}

/** Builds and owns the Hono app: middleware, API routes, and UI static serving. */
export class SiloServer {
  private readonly service: SiloService;
  private readonly version: string;
  private readonly authDisabled: boolean;
  private readonly logger: Logger;
  private readonly logRequests: boolean;

  constructor(service: SiloService, options: SiloServerOptions) {
    this.service = service;
    this.version = options.version;
    this.authDisabled = options.authDisabled;
    this.logger = options.logger;
    this.logRequests = options.logRequests ?? false;
  }

  build(): Hono {
    const app = new Hono();

    // Registered rather than gated inside the middleware, so a server with
    // request logging off pays nothing per request for the decision.
    if (this.logRequests) {
      app.use("*", LoggingMiddleware.create(this.logger));
    }

    // Enable CORS
    app.use("/api/*", cors());

    // Authentication middleware
    app.use("/api/*", AuthMiddleware.create(this.service, this.authDisabled));

    // Health check
    app.get("/api/health", (c) => {
      return c.json({ status: "ok", version: this.version });
    });

    // Register domain handlers
    RouteManager.registerRoutes(app, this.service);

    // Global Error Handler
    app.onError((err, c) => {
      // ValidationError.is, not instanceof: it crosses the @silo/shared package
      // boundary, so prototype identity is not a safe test. See its document comment.
      if (ValidationError.is(err)) {
        return c.json(
          {
            error: {
              code: "validation_failed",
              message: err.message,
              details: err.details,
            },
          },
          400
        );
      }
      if (err instanceof NotFoundError) {
        return c.json(
          { error: { code: "not_found", message: err.message } },
          404
        );
      }
      // Before ConflictError only because it is not one: a staged deletion is
      // a storage failure the caller can act on, not a refusal, and it needs
      // its own code so a client can tell the two media-delete outcomes apart.
      if (err instanceof MediaDeleteStalledError) {
        this.logger.error("media delete stalled", { media_id: err.mediaId, reason: err.reason });
        return c.json(
          {
            error: {
              code: "media_delete_stalled",
              message: err.message,
              details: {
                media_id: err.mediaId,
                blob_key: err.blobKey,
                reason: err.reason,
                remedy: "silo media reconcile",
              },
            },
          },
          500
        );
      }
      if (err instanceof ConflictError) {
        return c.json(
          { error: { code: "conflict", message: err.message } },
          409
        );
      }
      if (err instanceof UnauthorizedError) {
        return c.json(
          { error: { code: "unauthorized", message: err.message } },
          401
        );
      }
      if (err instanceof ForbiddenError) {
        return c.json(
          { error: { code: "forbidden", message: err.message } },
          403
        );
      }

      this.logger.error("internal error", { message: err instanceof Error ? err.message : String(err) });
      if (err instanceof Error && err.stack) this.logger.debug("internal error stack", { stack: err.stack });
      return c.json(
        { error: { code: "internal", message: "internal error" } },
        500
      );
    });

    // The admin UI. One handler serves the files and the SPA fallback both,
    // because every path that is neither an API route nor an asset belongs to
    // the client router. Where the files come from is `UiAssets`' problem: a
    // release binary carries them, a source checkout reads ./apps/admin/dist.
    app.all("/*", async (c) => {
      const reqPath = c.req.path;
      if (reqPath.startsWith("/api/")) {
        return c.json(
          { error: { code: "not_found", message: "not found" } },
          404
        );
      }

      const asset = await UiAssets.resolve(reqPath);
      if (asset) {
        return new Response(asset, { headers: SiloServer.cacheHeaders(reqPath) });
      }

      const index = await UiAssets.index();
      if (index) {
        return new Response(index, { headers: { "cache-control": "no-cache" } });
      }

      return c.text(
        "Admin UI not built. Run 'bun run --cwd ui build' from the repo root.",
        404
      );
    });

    return app;
  }

  /**
   * Vite content-hashes everything it emits under `/assets/`, so those URLs
   * name one immutable body for all time and can be cached as such. Nothing
   * else can: `index.html` is the file that points at the current hashes, and
   * the two SVGs keep their names across builds.
   */
  private static cacheHeaders(requestPath: string): Record<string, string> {
    return requestPath.startsWith("/assets/")
      ? { "cache-control": "public, max-age=31536000, immutable" }
      : { "cache-control": "no-cache" };
  }
}
