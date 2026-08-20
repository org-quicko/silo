import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { cors } from "hono/cors";
import type { Service } from "../core/service/service";
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
  private readonly svc: Service;
  private readonly version: string;
  private readonly authDisabled: boolean;
  private readonly logger: Logger;
  private readonly logRequests: boolean;

  constructor(svc: Service, options: SiloServerOptions) {
    this.svc = svc;
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
    app.use("/api/*", AuthMiddleware.create(this.svc, this.authDisabled));

    // Health check
    app.get("/api/health", (c) => {
      return c.json({ status: "ok", version: this.version });
    });

    // Register domain handlers
    RouteManager.registerRoutes(app, this.svc);

    // Global Error Handler
    app.onError((err, c) => {
      // ValidationError.is, not instanceof: it crosses the @silo/shared package
      // boundary, so prototype identity is not a safe test. See its doc comment.
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

    // Serve static assets if they exist in ui/dist
    app.use(
      "/*",
      serveStatic({
        root: "./ui/dist",
      })
    );

    // Fallback for SPA routing to index.html (excluding api routes)
    app.all("/*", async (c) => {
      const reqPath = c.req.path;
      if (reqPath.startsWith("/api/")) {
        return c.json(
          { error: { code: "not_found", message: "not found" } },
          404
        );
      }

      try {
        const file = Bun.file("./ui/dist/index.html");
        if (await file.exists()) {
          return new Response(file);
        }
      } catch {}

      return c.text(
        "Admin UI not built. Run 'npm run build' inside ui/ directory.",
        404
      );
    });

    return app;
  }
}
