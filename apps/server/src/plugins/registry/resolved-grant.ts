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

  /**
   * The managed `_keys` record this plugin acts as, or `""` while it is pending
   * or revoked and no key exists (D35).
   *
   * The **name** in a trail, not the authority: `claims` above is what the
   * injected principal presents, because an operator may grant through
   * `silo.toml` as well as through the record and the key only ever holds the
   * record's half. Carried here so `PluginContext` can name the caller without
   * a second read of a record the loader has already seen.
   */
  keyId: string;
}
