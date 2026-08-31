import type { SiloService } from "../../core/services/silo-service";
import type { PluginSupervisor } from "../../plugins";
import type { ConfigSupervisor, MediaPolicySupervisor, MediaStorageSupervisor } from "../../settings";
import { ProjectsRoutes } from "./projects-routes";
import { CollectionsRoutes } from "./collections-routes";
import { EntriesRoutes } from "./entries-routes";
import { KeysRoutes } from "./keys-routes";
import { TransferRoutes } from "./transfer-routes";
import { MediaRoutes } from "./media-routes";
import { MediaSettingsRoutes } from "./media-settings-routes";
import { SettingsRoutes } from "./settings-routes";
import { MediaStorageRoutes } from "./media-storage-routes";
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
  static registerRoutes(
    app: any,
    service: SiloService,
    plugins: PluginSupervisor,
    mediaStorage: MediaStorageSupervisor,
    mediaPolicy: MediaPolicySupervisor,
    settings: ConfigSupervisor
  ) {
    SessionRoutes.register(app);
    // Plugin *management* (D34/D38/D39), registered before the scoped param
    // routes for the same ordering reason the rest of this list exists.
    PluginRoutes.register(app, service, plugins);
    // Plugin-contributed routes (D36, phase 6), kept out of /api/plugins/ so a
    // plugin name can never collide with a management verb. One Hono route for
    // all of them — see `ExtRoutes` for why plugins are not let into this list.
    ExtRoutes.register(app, plugins);
    AuditRoutes.register(app, service);
    SettingsRoutes.register(app, settings);
    KeysRoutes.register(app, service);
    TransferRoutes.register(app, service);
    CopyRoutes.register(app, service);
    // Before MediaRoutes, so "storage" and "settings" are never read as asset ids.
    MediaStorageRoutes.register(app, mediaStorage);
    MediaSettingsRoutes.register(app, mediaPolicy);
    MediaRoutes.register(app, service);

    ProjectsRoutes.register(app, service);
    CollectionsRoutes.register(app, service);
    SearchRoutes.register(app, service);
    EntriesRoutes.register(app, service);
  }
}
