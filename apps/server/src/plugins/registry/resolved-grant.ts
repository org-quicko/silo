import type { HookName } from "@silo/shared/hook-name";
import type { PluginGrant } from "../../core/plugins/plugin-grant";

/** One plugin's authority, as `PluginGrantResolver` worked it out (D34). */
export interface ResolvedGrant {
  /** Everything the operator has allowed, from `silo.toml` and `_plugins` both.
   *  An empty list is what "pending" looks like at every check site, which is
   *  why pending needs no code path of its own. */
  claims: string[];

  /** Where the plugin stands, for `plugin list` and the startup log. Reporting
   *  only — behaviour comes from `claims`. */
  state: PluginGrant["state"];

  /** Requested and not granted. Not an error: a plugin may run on less than it
   *  asked for, which is what an `optional` request is. */
  missing: string[];

  /** Declared hooks this plugin may be delivered **nowhere**. Refused at load,
   *  because the alternative is a plugin that runs and quietly does nothing. */
  undeliverable: HookName[];
}
