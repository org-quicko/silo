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

  // Plugin management (D34). D31 declined these because there was no install
  // API for them to guard; `_plugins` is that API, so the reasoning inverts.
  // `PluginsGrant` and `PluginsEnable` are privilege-escalation primitives —
  // a plugin runs code — so `PluginGrantService` refuses to grant any of them
  // *to a plugin*, and only `root` carries them by preset.
  static readonly PluginsRead = "plugins:read";
  static readonly PluginsConfigure = "plugins:configure";
  static readonly PluginsGrant = "plugins:grant";
  static readonly PluginsEnable = "plugins:enable";

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
    [ClaimVocabulary.PluginsRead]: true,
    [ClaimVocabulary.PluginsConfigure]: true,
    [ClaimVocabulary.PluginsGrant]: true,
    [ClaimVocabulary.PluginsEnable]: true,
  };

  /**
   * The fixed claims a **plugin** may never be granted (D34).
   *
   * A plugin runs code, so a plugin holding `plugins:grant` could widen its own
   * grant and then act on it — the one escalation the grant model cannot
   * express its way out of. Refused at the grant, not at the call, so it is
   * visible to whoever is approving rather than surfacing later as a 403.
   */
  static readonly PluginForbiddenClaims: readonly FixedClaim[] = [
    ClaimVocabulary.PluginsGrant,
    ClaimVocabulary.PluginsEnable,
    ClaimVocabulary.PluginsConfigure,
  ];

  static readonly Presets: Record<ClaimPreset, true> = {
    read: true,
    write: true,
    manage: true,
    root: true,
  };
}
