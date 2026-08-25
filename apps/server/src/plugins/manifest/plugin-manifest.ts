import type { HookName } from "../../core/hooks";
import type { PluginRoute } from "./plugin-route";
import type { ProviderPort } from "./provider-port";

/**
 * A plugin's **static** metadata, read from `package.json#silo` (D31/§13.2).
 *
 * Static is the point. `silo plugin info` has to show an operator what a
 * package wants **before** any of its code runs, and a manifest that had to be
 * executed to be read could not answer that. So capability declarations live
 * here and only *behaviour* lives in the module's default export.
 */
export interface PluginManifest {
  /** The package name, which is also how `[[plugins]] name` addresses it. */
  name: string;

  /** A range against `SiloVersion` (D28) — `"^1"`. There is no separate plugin
   *  API version; see D31 and D13. */
  silo: string;

  kind: "extension" | "provider";

  /** Declared up front so `silo plugin doctor` can report what a plugin will
   *  attach to without loading it, and so a plugin cannot quietly grow a hook
   *  the operator never saw. A hook the module exports but does not declare is
   *  never dispatched. */
  hooks: readonly HookName[];

  /**
   * The HTTP routes this plugin serves under `/api/ext/{name}/*` (D36, phase 6).
   *
   * Declared for the same reason `hooks` is: an operator approves what a package
   * will expose before it runs, and a route the module implements but does not
   * declare is never reachable. Serving them at all costs the `http:route`
   * claim, so a package can ask and be refused without the routes vanishing
   * from what the grant screen shows.
   */
  routes: readonly PluginRoute[];

  /** What the plugin asks for. The operator grants through `[[plugins]] claims`;
   *  the two are compared at load, so a plugin cannot be silently
   *  under-granted. */
  claims: readonly string[];

  /**
   * JSON Schema (D3) for `[plugins.config]`, validated at startup.
   *
   * Carried at 1.0 even though nothing renders it, which is what lets the admin
   * settings form arrive later through RJSF with no manifest change.
   */
  config?: any;

  /** Present only when `kind` is `"provider"`. */
  provider?: {
    port: ProviderPort;
    /** The name `[storage] driver` (or the blob equivalent) selects it by.
     *  Reserved names are refused — see `ProviderRegistry`. */
    driver: string;
  };
}
