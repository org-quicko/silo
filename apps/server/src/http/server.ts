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
import { PluginStartError } from "../core/errors/plugin-start-error";
import { UnauthorizedError } from "../core/errors/unauthorized-error";
import { ForbiddenError } from "../core/errors/forbidden-error";
import type { Logger } from "../logging/logger";
import { PluginRegistry, PluginSupervisor, ProviderRegistry } from "../plugins";
import { ConfigSupervisor, MediaPolicySupervisor, MediaStorageSupervisor } from "../settings";
import { ConfigLoader } from "../config/config-loader";
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

  /**
   * The live plugin set the management API acts on (D39, phase 4).
   *
   * Optional, and the absence is filled with a supervisor over an empty
   * registry rather than by branching the routes. "No plugins are running in
   * this process" is a true answer that `/api/plugins` can give in full — the
   * records are still there, and every view still reports `runtime` — so a
   * server built without one behaves the same way rather than a lesser way.
   */
  plugins?: PluginSupervisor;

  /**
   * Where the media library keeps its bytes, and what may change it (D45).
   *
   * Optional the same way `plugins` is, and filled the same way: a supervisor
   * over this process's defaults, which can report the configuration in force
   * and refuses a save because there is no file to write. "This process was not
   * started from a config file" is a true answer the page can render, and a
   * better one than a route that is missing.
   */
  mediaStorage?: MediaStorageSupervisor;

  /** Where media URLs point and what the library accepts (D46). Optional and
   *  defaulted for `mediaStorage`'s reason, and refuses a save for the same
   *  one: there is no file to write. */
  mediaPolicy?: MediaPolicySupervisor;

  /** The rest of `silo.toml`, read and changed through the API (D47). Optional
   *  and defaulted for `mediaStorage`'s reason: "this process was not started
   *  from a config file" is a true answer the page can render. */
  settings?: ConfigSupervisor;
}

/** Builds and owns the Hono app: middleware, API routes, and UI static serving. */
export class SiloServer {
  private readonly service: SiloService;
  private readonly version: string;
  private readonly authDisabled: boolean;
  private readonly logger: Logger;
  private readonly plugins: PluginSupervisor;
  private readonly mediaStorage: MediaStorageSupervisor;
  private readonly mediaPolicy: MediaPolicySupervisor;
  private readonly settings: ConfigSupervisor;

  constructor(service: SiloService, options: SiloServerOptions) {
    this.service = service;
    this.version = options.version;
    this.authDisabled = options.authDisabled;
    this.logger = options.logger;
    // An explicit option still wins at construction, for an embedder that wants
    // an access log without a `[log]` table. Absent, whatever `Logger.create`
    // read from the config stands.
    if (options.logRequests !== undefined) options.logger.useRequests(options.logRequests);
    this.plugins =
      options.plugins ??
      new PluginSupervisor({
        registry: PluginRegistry.empty(options.logger),
        service,
        logger: options.logger,
        // Defaults, whose `plugins` array is empty: this process was not handed
        // a config file, so it lists no plugins and `rescan` has nothing to
        // re-read — which is what it says rather than inventing a path.
        config: ConfigLoader.defaultConfig(),
      });
    this.mediaStorage =
      options.mediaStorage ??
      new MediaStorageSupervisor({
        service,
        providers: ProviderRegistry.withBuiltins(),
        logger: options.logger,
        // No `reload` and no `configPath`, for the reason above: a save refuses
        // rather than guessing at `./silo.toml`, since a config file appearing
        // in somebody's repository is not a side effect of pressing Save.
        config: ConfigLoader.defaultConfig(),
      });
    this.mediaPolicy =
      options.mediaPolicy ??
      new MediaPolicySupervisor({
        service,
        logger: options.logger,
        config: ConfigLoader.defaultConfig(),
      });
    this.settings =
      options.settings ??
      new ConfigSupervisor({
        service,
        logger: options.logger,
        config: ConfigLoader.defaultConfig(),
      });
  }

  build(): Hono {
    const app = new Hono();

    // Registered rather than gated inside the middleware, so a server with
    // request logging off pays nothing per request for the decision.
    // Always installed; the logger decides per request, so `[log] requests` can
    // be switched from the settings API without a restart (D47).
    app.use("*", LoggingMiddleware.create(this.logger));

    // Enable CORS
    app.use("/api/*", cors());

    // Authentication middleware
    app.use("/api/*", AuthMiddleware.create(this.service, this.authDisabled));

    // Health check
    app.get("/api/health", (c) => {
      return c.json({ status: "ok", version: this.version });
    });

    // Register domain handlers
    RouteManager.registerRoutes(
      app,
      this.service,
      this.plugins,
      this.mediaStorage,
      this.mediaPolicy,
      this.settings
    );

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
      // Before ConflictError for the reason MediaDeleteStalledError is: it is
      // not a refusal. The request was well formed and the caller did nothing
      // wrong — the package on disk cannot start — and the loader's own message
      // is the whole value of the response (D39).
      if (err instanceof PluginStartError) {
        this.logger.error("plugin failed to start", {
          plugin: err.plugin,
          message: err.message,
        });
        return c.json(
          {
            error: {
              code: "plugin_start_failed",
              message: err.message,
              details: {
                plugin: err.plugin,
                remedy: "silo plugin doctor",
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
