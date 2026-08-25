import type { SiloService } from "../../core/services/silo-service";
import type { PluginSupervisor } from "../../plugins";
import { ProjectsRoutes } from "./projects-routes";
import { CollectionsRoutes } from "./collections-routes";
import { EntriesRoutes } from "./entries-routes";
import { KeysRoutes } from "./keys-routes";
import { TransferRoutes } from "./transfer-routes";
import { MediaRoutes } from "./media-routes";
import { CopyRoutes } from "./copy-routes";
import { SessionRoutes } from "./session-routes";
import { SearchRoutes } from "./search-routes";
import { PluginRoutes } from "./plugin-routes";
import { ExtRoutes } from "./ext-routes";
import { AuditRoutes } from "./audit-routes";

/**
 * Composes all route modules onto the app. Ordering matters for Hono's
 * router: static routes (`/api/keys`, ...) must be
 * registered before the `/api/projects...` param routes, and within a
 * collection's routes, `/schema` must be registered before the
 * generic `/:id` entry routes so it isn't captured as an id. The same applies
 * to `/collections/{name}/search` (D30), which is why `SearchRoutes` comes
 * before `EntriesRoutes`.
 */
export class RouteManager {
  static registerRoutes(app: any, service: SiloService, plugins: PluginSupervisor) {
    SessionRoutes.register(app);
    // Plugin *management* (D34/D38/D39), registered before the scoped param
    // routes for the same ordering reason the rest of this list exists.
    PluginRoutes.register(app, service, plugins);
    // Reserved for plugin-contributed routes (D36), kept out of /api/plugins/
    // so a plugin name can never collide with a management verb.
    ExtRoutes.register(app);
    AuditRoutes.register(app, service);
    KeysRoutes.register(app, service);
    TransferRoutes.register(app, service);
    CopyRoutes.register(app, service);
    MediaRoutes.register(app, service);

    ProjectsRoutes.register(app, service);
    CollectionsRoutes.register(app, service);
    SearchRoutes.register(app, service);
    EntriesRoutes.register(app, service);
  }
}
