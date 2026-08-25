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
}
