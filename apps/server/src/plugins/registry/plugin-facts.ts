import type { PluginGrant } from "../../core/plugins/plugin-grant";
import type { PluginRoute } from "../manifest/plugin-route";
import type { PluginStatus } from "./plugin-status";

/**
 * What the package declares, as much of it as a management surface needs
 * (D40, phase 5).
 *
 * `kind` because the affordances differ absolutely: a provider *is* the
 * storage, runs in-process, has no worker to restart and no hooks to be
 * delivered — a UI offering those would be offering nothing.
 *
 * `config_schema` because D31 put the schema in the manifest and said why:
 * "carried at 1.0 even though nothing renders it, which is what lets the admin
 * settings form arrive later through RJSF with no manifest change". Phase 5 is
 * that later, and this is the field it needed.
 */
export interface PluginManifestFacts {
  kind: "extension" | "provider";
  /** JSON Schema for `[plugins.config]`, or `null` when the plugin declares
   *  none — which means it takes no configuration, not that anything is
   *  wrong. */
  config_schema: unknown | null;

  /**
   * The routes the package declares, which is what an operator approves (D36,
   * phase 6).
   *
   * From the **manifest** and not from the grant, because the point of showing
   * them is deciding: `http:route` is one claim covering all of them, so the
   * list is the only place the decision has any detail. `auth` matters most —
   * a handler runs with the plugin's authority, so a `public` route publishes
   * whatever that plugin holds at a URL anyone can reach, and that is the one
   * property of a route nobody can infer from the claim.
   */
  routes: readonly PluginRoute[];
}

/**
 * Everything a management surface asks about one plugin that the `_plugins`
 * record cannot answer (D39, extended by D40).
 *
 * The record holds *intent*; this is outcome, declaration and effective config.
 * Gathered in one pass so the package on disk is read once per plugin per
 * request rather than once per question.
 */
export interface PluginFacts {
  status: PluginStatus;

  /**
   * The **other** half of the grant: what `silo.toml` allows this plugin
   * (D34's union, made visible by D40).
   *
   * The `_plugins` record describes the stored half only, so a surface reading
   * it alone reports a plugin granted entirely through the file as approved for
   * nothing — measured on a running instance, where a plugin answering `ctx`
   * calls with `200` was reported `pending`, `granted: []`, and everything it
   * asked for still to approve. Every one of those was false, and a grant screen
   * built on them would have offered to approve what was already running.
   */
  config_claims: string[];

  /** What the plugin actually holds: `config_claims` unioned with the record's
   *  grant. */
  effective: string[];

  /** Where it stands given **both** halves — `PluginGrantResolver.state`, the
   *  same function the startup log and the CLI report through. */
  state: PluginGrant["state"];
  /** `null` when the package could not be read at all — `status.detail` is
   *  where that says so, rather than being repeated here. */
  manifest: PluginManifestFacts | null;
  config: Record<string, unknown>;
  source: "silo.toml" | "store";
}
