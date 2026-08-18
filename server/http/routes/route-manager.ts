import type { Service } from "../../core/service/service";
import { ProjectsRoutes } from "./projects-routes";
import { CollectionsRoutes } from "./collections-routes";
import { EntriesRoutes } from "./entries-routes";
import { KeysRoutes } from "./keys-routes";
import { TransferRoutes } from "./transfer-routes";
import { MediaRoutes } from "./media-routes";
import { CopyRoutes } from "./copy-routes";
import { SessionRoutes } from "./session-routes";

/**
 * Composes all route modules onto the app. Ordering matters for Hono's
 * router: static routes (`/api/keys`, ...) must be
 * registered before the `/api/projects...` param routes, and within a
 * collection's routes, `/schema` must be registered before the
 * generic `/:id` entry routes so it isn't captured as an id.
 */
export class RouteManager {
  static registerRoutes(app: any, svc: Service) {
    SessionRoutes.register(app);
    KeysRoutes.register(app, svc);
    TransferRoutes.register(app, svc);
    CopyRoutes.register(app, svc);
    MediaRoutes.register(app, svc);

    ProjectsRoutes.register(app, svc);
    CollectionsRoutes.register(app, svc);
    EntriesRoutes.register(app, svc);
  }
}
