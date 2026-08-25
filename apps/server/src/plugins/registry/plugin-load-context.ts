import type { SiloService } from "../../core/services/silo-service";
import type { Logger } from "../../logging/logger";
import type { PluginApiDispatcher } from "../runtime";

/**
 * Everything loading *any* extension plugin needs, independent of which one
 * (D39, phase 4).
 *
 * Split out of `ExtensionLoadOptions` when the supervisor arrived: starting the
 * whole configured list at boot and starting one plugin an operator just enabled
 * are the same act with a different subject, and a second copy of this wiring
 * would be a second place for the two to drift apart.
 */
export interface PluginLoadContext {
  /** `<data dir>/plugins/`. */
  pluginsDir: string;
  service: SiloService;
  logger: Logger;
  /** Where a plugin's `ctx.fetch` lands (D35). Shared by every plugin, and
   *  handed the app once the server exists — see `PluginRegistry.attach`. */
  dispatcher: PluginApiDispatcher;
}
