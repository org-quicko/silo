import type { PluginGrantRecord } from "../../core/plugins/plugin-grant-record";
import { PluginGrantUtils } from "../../core/plugins/plugin-grant-utils";
import type { PluginFacts, PluginStatus } from "../../plugins";

/** What `GET /api/plugins` returns per plugin (D38, D39). */
export interface PluginView {
  name: string;
  state: PluginGrantRecord["state"];
  /** Absent `enabled` means enabled, but the wire form is explicit — a client
   *  reading `undefined` as false would show every plugin as off. */
  enabled: boolean;
  requested: string[];

  /** What the operator approved **through the record** — the half this API can
   *  change. `config_claims` is the other half, and `effective` is the two of
   *  them together. */
  granted: string[];

  /**
   * What `silo.toml` grants this plugin (D40).
   *
   * D34 made effective authority the **union** of the file and the record, and
   * until now this surface reported only the record — so a plugin granted
   * entirely through the file was reported as approved for nothing while it ran
   * on exactly what the file said. Both halves are here because the union rule
   * is the one thing about grants that can quietly mislead, and because
   * `DELETE .../grant` clears only one of them.
   */
  config_claims: string[];

  /** `granted` unioned with `config_claims`: what the plugin actually holds. */
  effective: string[];

  /**
   * `requested` minus `effective`, computed here rather than left to the client.
   *
   * It is the reviewable part of a grant — "approved everything" and "approved
   * two of nine" are different decisions — and a client that derived it would be
   * a second implementation of `Claims.has`, which is the wildcard-aware
   * comparison this repo keeps in exactly one place.
   */
  not_granted: string[];
  hooks: string[];
  /** The managed key carrying the grant. Its id only: the secret is host-side
   *  and exists nowhere a response could reach (D34). */
  key_id: string | null;
  granted_by: string | null;
  granted_at: string | null;
  /** The revision to send back as `If-Match` on a change. */
  rev: number;

  /**
   * What the plugin is actually doing (D39, phase 4).
   *
   * `enabled` and `state` are intent — what an operator decided — and this is
   * outcome. They can disagree: a granted, enabled plugin whose worker died on a
   * dispatch timeout is not running, and before a supervisor existed no surface
   * could say so. This is what replaced `restart_required`, which every mutation
   * used to return because there was nothing truer to say.
   */
  runtime: PluginStatus;

  /** The config the plugin runs with, and which of the two sources won. Both,
   *  because an override makes `silo.toml`'s block stop applying and "this is
   *  not what my file says" is the question that creates. */
  config: Record<string, unknown>;
  config_source: "silo.toml" | "store";

  /**
   * Extension or provider — `null` when the package could not be read, which
   * `runtime.detail` explains rather than this repeating it.
   *
   * A provider *is* the storage: it runs in-process, has no worker and takes no
   * hooks, so every lifecycle affordance a client would otherwise offer for it
   * is one that does nothing. That is a different sentence from "stopped", and a
   * surface with no way to tell the two apart has to pick one of them to be
   * wrong about (D40).
   */
  kind: "extension" | "provider" | null;

  /**
   * JSON Schema for the config block, straight from the manifest.
   *
   * D31 put it there and said why: carried at 1.0 "even though nothing renders
   * it, which is what lets the admin settings form arrive later through RJSF
   * with no manifest change". `null` means the plugin declares none — it takes
   * no configuration, which is not the same as something being wrong.
   */
  config_schema: unknown | null;
}

export class PluginViews {
  static of(record: PluginGrantRecord, facts: PluginFacts): PluginView {
    return {
      name: record.name,
      // The resolver's answer, not the record's: the record only ever describes
      // the stored half, and a plugin granted through `silo.toml` sits at
      // `pending` there forever (D40).
      state: facts.state,
      enabled: record.enabled !== false,
      requested: record.requested,
      granted: record.granted,
      config_claims: facts.config_claims,
      effective: facts.effective,
      not_granted: PluginGrantUtils.missing(record.requested, facts.effective),
      hooks: record.hooks,
      key_id: record.key_id ?? null,
      granted_by: record.granted_by,
      granted_at: record.granted_at ?? null,
      rev: record.rev,
      runtime: facts.status,
      config: facts.config,
      config_source: facts.source,
      kind: facts.manifest?.kind ?? null,
      config_schema: facts.manifest?.config_schema ?? null,
    };
  }
}
