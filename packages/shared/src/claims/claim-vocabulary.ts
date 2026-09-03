import type { ClaimPreset } from "./claim-preset";
import type { CollectionPermission } from "./collection-permission";
import type { FixedClaim } from "./fixed-claim";

/**
 * Every claim string silo knows, and the tables that keep the lists complete.
 *
 * `Claims` extends this, so the constants are reachable as `Claims.Root` and
 * friends without being restated anywhere.
 */
export class ClaimVocabulary {
  static readonly Root = "*";

  static readonly CollectionCreate = "create";
  static readonly CollectionDelete = "delete";
  static readonly CollectionSchemaRead = "schema:read";
  static readonly CollectionSchemaUpdate = "schema:update";
  static readonly CollectionAccessUpdate = "access:update";
  static readonly CollectionEntriesCreate = "entries:create";
  static readonly CollectionEntriesRead = "entries:read";
  static readonly CollectionEntriesUpdate = "entries:update";
  static readonly CollectionEntriesDelete = "entries:delete";

  static readonly KeysRead = "keys:read";
  static readonly KeysCreate = "keys:create";
  static readonly KeysRevoke = "keys:revoke";
  static readonly KeysExport = "keys:export";
  static readonly KeysImport = "keys:import";
  static readonly TransferExport = "transfer:export";
  static readonly TransferImport = "transfer:import";
  static readonly TransferCopy = "transfer:copy";
  static readonly MediaRead = "media:read";
  static readonly MediaCreate = "media:create";
  static readonly MediaDelete = "media:delete";
  /** Reading and changing how the media library is set up: where it keeps its
   *  bytes (D45), where its URLs point, and what it accepts (D46). A
   *  configuration claim, not a per-asset one — see `PluginForbiddenClaims`
   *  and §6.4 / §6.5 in `docs/design/storage.md`. */
  static readonly MediaConfigure = "media:configure";

  /**
   * Reading and changing the rest of `silo.toml` from the API (D47): logging,
   * search, schema validation and the auth switch.
   *
   * One claim rather than a read/write pair, following `media:configure`: the
   * read is not the harmless half. It names the data directory, the log path
   * and whether authentication is on at all, which is a map of the instance
   * rather than metadata about it.
   */
  static readonly SettingsConfigure = "settings:configure";

  // Plugin management (D34). D31 declined these because there was no install
  // API for them to guard; `_plugins` is that API, so the reasoning inverts.
  // `PluginsGrant` and `PluginsEnable` are privilege-escalation primitives —
  // a plugin runs code — so `PluginGrantService` refuses to grant any of them
  // *to a plugin*, and only `root` carries them by preset.
  static readonly PluginsRead = "plugins:read";
  static readonly PluginsConfigure = "plugins:configure";
  static readonly PluginsGrant = "plugins:grant";
  static readonly PluginsEnable = "plugins:enable";

  // The trail of authority changes (D38). Read-only by construction: nothing
  // updates or deletes an audit event, so there is no `audit:write` for a claim
  // to guard and inventing one would imply a capability that does not exist.
  static readonly AuditRead = "audit:read";

  /**
   * Read bounded, aggregate operating metrics for this process: normalized API
   * routes, status classes, latency, memory/CPU totals and local storage size.
   *
   * No request path parameters, query strings, caller identities, content or
   * filesystem paths cross this boundary. Keeping it separate from
   * `settings:configure` lets an operator or an ordinary plugin inspect health
   * without gaining the ability to rewrite `silo.toml`.
   */
  static readonly ObservabilityRead = "observability:read";

  /**
   * Serving the routes a plugin declared, under `/api/ext/{name}/*` (D36, phase
   * 6).
   *
   * A **plugin-shaped** claim, like `hooks:…`: it authorises being *reached*,
   * not reaching anything, so a key that holds it gains nothing. It is one
   * claim rather than one per route because the routes are already enumerated in
   * the manifest and mounted under the plugin's own name — a plugin cannot
   * escape its prefix, so there is no reach for a scope to narrow. What the
   * operator weighs is the route list, which the grant screen shows.
   */
  static readonly HttpRoute = "http:route";

  // These lookup tables are `Record<Union, true>` rather than sets so the
  // compiler enforces that they stay *complete*: adding a member to one of the
  // unions without listing it here is an error, instead of a claim that
  // typechecks everywhere and is then rejected at runtime by `normalize`.
  // Read them only through `Object.hasOwn`, never `in` — inherited keys like
  // "constructor" must not validate.
  static readonly CollectionPermissions: Record<CollectionPermission, true> = {
    [ClaimVocabulary.CollectionCreate]: true,
    [ClaimVocabulary.CollectionDelete]: true,
    [ClaimVocabulary.CollectionSchemaRead]: true,
    [ClaimVocabulary.CollectionSchemaUpdate]: true,
    [ClaimVocabulary.CollectionAccessUpdate]: true,
    [ClaimVocabulary.CollectionEntriesCreate]: true,
    [ClaimVocabulary.CollectionEntriesRead]: true,
    [ClaimVocabulary.CollectionEntriesUpdate]: true,
    [ClaimVocabulary.CollectionEntriesDelete]: true,
  };

  static readonly FixedClaims: Record<FixedClaim, true> = {
    [ClaimVocabulary.KeysRead]: true,
    [ClaimVocabulary.KeysCreate]: true,
    [ClaimVocabulary.KeysRevoke]: true,
    [ClaimVocabulary.KeysExport]: true,
    [ClaimVocabulary.KeysImport]: true,
    [ClaimVocabulary.TransferExport]: true,
    [ClaimVocabulary.TransferImport]: true,
    [ClaimVocabulary.TransferCopy]: true,
    [ClaimVocabulary.MediaRead]: true,
    [ClaimVocabulary.MediaCreate]: true,
    [ClaimVocabulary.MediaDelete]: true,
    [ClaimVocabulary.MediaConfigure]: true,
    [ClaimVocabulary.SettingsConfigure]: true,
    [ClaimVocabulary.PluginsRead]: true,
    [ClaimVocabulary.PluginsConfigure]: true,
    [ClaimVocabulary.PluginsGrant]: true,
    [ClaimVocabulary.PluginsEnable]: true,
    [ClaimVocabulary.AuditRead]: true,
    [ClaimVocabulary.ObservabilityRead]: true,
    [ClaimVocabulary.HttpRoute]: true,
  };

  /**
   * The fixed claims a **plugin** may never be granted (D34, extended by D37,
   * D45 and D47).
   *
   * A plugin runs code, so each of these is a way out of its own grant, and a
   * grant model that can be stepped around is decoration. Four shapes:
   *
   * - `plugins:*` **widen the record.** A plugin holding `plugins:grant` grants
   *   itself more and then acts on it.
   * - `media:configure` **moves the bytes.** It repoints the whole library at a
   *   bucket and a credential of the holder's choosing, so a plugin holding it
   *   receives every future upload in the instance — including uploads made by
   *   keys it has no `media:read` over — and it does that by writing the
   *   operator's `silo.toml`, which is the file that decides what code runs
   *   (D45). Neither half survives being granted to a package.
   * - `settings:configure` **changes the ground everything else stands on.** It
   *   writes the same `silo.toml`, and `[schema] allow_remote_refs` alone turns
   *   every schema validation into an outbound fetch of the holder's choosing
   *   (D47). Like `media:configure`, it is a way for a package to rewrite the
   *   file that decides what code runs.
   * - `keys:*` **bypass the record.** `keys:create` mints an *unmanaged* key,
   *   which is a credential nothing revokes when the plugin is revoked;
   *   `keys:import` plants a `_keys` row whose hash the planter chose, which is
   *   root with no grant at all (D37 measured it); `keys:revoke` destroys other
   *   principals' credentials, which is not escalation but is a lockout.
   *
   * `keys:read` and `keys:export` are deliberately **not** here. They disclose
   * the authority map — labels, claims, prefixes — and disclosure is a decision
   * an operator can weigh. These eight are not, because no grant that includes
   * them means what it says.
   *
   * Refused at the grant, not at the call, so it is visible to whoever is
   * approving rather than surfacing later as a 403.
   */
  static readonly PluginForbiddenClaims: readonly FixedClaim[] = [
    ClaimVocabulary.PluginsGrant,
    ClaimVocabulary.PluginsEnable,
    ClaimVocabulary.PluginsConfigure,
    ClaimVocabulary.MediaConfigure,
    ClaimVocabulary.SettingsConfigure,
    ClaimVocabulary.KeysCreate,
    ClaimVocabulary.KeysRevoke,
    ClaimVocabulary.KeysImport,
  ];

  static readonly Presets: Record<ClaimPreset, true> = {
    read: true,
    write: true,
    manage: true,
    root: true,
  };
}
