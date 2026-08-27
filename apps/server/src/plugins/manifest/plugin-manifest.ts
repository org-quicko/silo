import type { PluginContributions } from "./plugin-contributions";
import type { PluginPermissions } from "./plugin-permissions";

/**
 * A plugin's **static** metadata, read from `package.json#silo` (D31/§13.2,
 * restructured by D36).
 *
 * Static is the point. `silo plugin info` has to show an operator what a package
 * wants **before** any of its code runs, and a manifest that had to be executed
 * to be read could not answer that. So capability declarations live here and only
 * *behaviour* lives in the module's default export.
 *
 * Two fields carry everything a package says about itself, and the split between
 * them is what a grant screen is made of: `contributes` is **what it will do**,
 * and `permissions` is **what it needs in order to do it**. `kind` and a flat
 * `claims` array used to stand in their place and could express neither — an enum
 * cannot describe a package that both provides storage and hooks the writes it
 * stores, and a bare claim list cannot say which of its entries the plugin is
 * broken without.
 */
export interface PluginManifest {
  /** The package name, which is also how `[[plugins]] name` addresses it. */
  name: string;

  /** A range against `SiloVersion` (D28) — `"^1"`. There is no separate plugin
   *  API version; see D31 and D13. */
  silo: string;

  /** Hooks, routes, a runtime, providers: any combination, none exclusive. */
  contributes: PluginContributions;

  /** The claims it asks for, split into `required` and `optional`, each with the
   *  author's reason. */
  permissions: PluginPermissions;

  /**
   * JSON Schema (D3) for `[plugins.config]`, validated at startup.
   *
   * Carried at 1.0 even though nothing rendered it then, which is what let the
   * admin settings form arrive later through RJSF with no manifest change.
   */
  config?: any;
}
