import type { PluginGrantState } from "./plugin-grant-state";

/**
 * What an operator has allowed one plugin to do (D34).
 *
 * Stored as an ordinary document in the reserved `_plugins` collection of
 * `Scope.System` — the trick D12 used for `_keys` and D23 for `_media`, so it
 * gets every adapter, export and query for free.
 *
 * It answers *what may run*. `silo.toml` still answers *what loads, and in what
 * order*, and the split is deliberate: **if grants lived in config, revoking
 * would need a restart; if registration lived in the store, whoever could write
 * the store could execute code.**
 */
export interface PluginGrant {
  /** The `[[plugins]] name`, and the record's natural key. */
  name: string;

  /** What the manifest asked for when this record was last reconciled. Kept so
   *  a grant can be shown beside the request that justified it, and so an
   *  upgrade's delta is computable without re-reading the package. */
  requested: string[];

  /**
   * The subset of `requested` the package declares it cannot work without (D36).
   *
   * In the record and not only in the manifest because `PUT .../grant` with no
   * body means "approve the default", and D38's rule is that the management API
   * acts on the record and **never on the filesystem**. Without this the default
   * grant would either have to read the package — which is the coupling that rule
   * exists to prevent — or approve everything, which is what made `optional`
   * worth introducing.
   *
   * Absent in a record written before D36, where there was no optional and so
   * everything requested was required. `PluginGrantUtils.requiredOf` is that
   * reading; nothing else should touch the field directly.
   */
  required?: string[];

  /** The hooks the manifest declares. Part of what an operator approves — a
   *  package that quietly adds one has changed its request even if its claims
   *  did not — so it is stored beside them rather than re-read from disk. */
  hooks: string[];

  /** What the operator actually allowed. Always a subset of `requested`, and
   *  always within the granting key's own authority. */
  granted: string[];

  state: PluginGrantState;

  /**
   * The manifest this grant was approved against.
   *
   * An upgrade that changes what a package asks for changes this, which is what
   * turns "did the request change?" into a comparison rather than a judgement.
   * A digest and not the manifest itself: the record is about the decision, and
   * the package on disk is about the package.
   */
  manifest_digest: string;

  /** The managed `_keys` record minted for this plugin, or absent while it is
   *  pending or revoked. */
  key_id?: string;

  /** The id of the key that last changed this grant, and when. `null` when the
   *  change came from the CLI against the data directory, which has no key. */
  granted_by: string | null;
  granted_at?: string;

  /**
   * Whether this plugin loads at all (D38).
   *
   * Absent means enabled, so nothing needs backfilling and the default stays
   * "a plugin listed in `silo.toml` runs". Disabling is the escape hatch for a
   * plugin misbehaving on an instance whose config file is not conveniently
   * editable — a container image, a config map — and it is deliberately
   * **orthogonal to the grant**: withdrawing authority and refusing to load are
   * different remedies, and collapsing them would mean re-approving a plugin
   * you only ever wanted to pause.
   *
   * Since phase 4 it takes effect **now**: `POST .../enable` starts the worker
   * and `POST .../disable` stops it, and the record is what the next start
   * reads so the two never disagree (D39).
   */
  enabled?: boolean;

  /**
   * The config this plugin runs with, when an operator set one through
   * `PATCH /api/plugins/{name}/config` (D39, phase 4).
   *
   * Absent means `silo.toml`'s `[plugins.config]` block is in force, which is
   * the ordinary case and needs no backfill. Present means the file's block is
   * **ignored** for this plugin until the override is cleared — this is not the
   * union `claims` gets, because a union of two documents has no readable answer
   * to "what config is this plugin running with", and `required` and
   * `additionalProperties` would then be judged against a value neither side
   * wrote. Whichever source is in force, `config_source` on the view says which.
   *
   * It lives in the record and not in the file for the same reason the grant
   * does: an instance whose `silo.toml` is a config map cannot be hand-edited,
   * and an API that could write the file would be a code-execution primitive
   * wearing a management claim (D34).
   */
  config?: Record<string, unknown>;
}
