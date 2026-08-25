import type { PluginPermission } from "./plugin-permission";

/**
 * What a package asks for, split by whether it can work without it (D36).
 *
 * This replaced a flat `claims` array, which could not express the difference
 * between "this plugin is broken without this" and "this plugin does more with
 * this". The distinction has to exist somewhere, because the default grant has to
 * pick something: granting everything asked for by default makes `optional`
 * meaningless, and granting nothing makes approval a chore that trains an
 * operator to click through it.
 *
 * So **the default grant is `required`**, and an optional permission is opt-in.
 * That is the only reading under which the two words mean what they say.
 */
export interface PluginPermissions {
  /** Without these the plugin does not do its job. Granted by default, and a
   *  grant that omits one is warned about at load. */
  required: readonly PluginPermission[];

  /** Extras. Ungranted is a normal outcome and never an error — which is what
   *  `ResolvedGrant.missing` has always described. */
  optional: readonly PluginPermission[];
}
