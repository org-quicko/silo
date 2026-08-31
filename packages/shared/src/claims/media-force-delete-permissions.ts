import { ClaimVocabulary } from "./claim-vocabulary";
import type { CollectionPermission } from "./collection-permission";

/**
 * The collection permission a media `?force=true` delete exercises, at
 * whatever scopes it actually reaches (D49).
 *
 * D48 shipped force gated on `media:delete` alone; that was wrong. A
 * force-deleted asset leaves every referring entry's *stored* value untouched
 * — the reference is never rewritten — but it changes what that reference
 * *resolves to*: `MediaLinkResolver` answers `null` where it used to answer a
 * URL. That is a bulk `entries:update` wearing a `media:delete` claim, the
 * fourth place the rule already stated three times — `ForcedDeletePermissions`,
 * `TransferPermissions.Replace` and `ScopeCopyPermissions.Replace` — is true:
 * a force must additionally hold the claims for the effects it cascades into.
 *
 * `entries:update`, not `entries:delete`: the entry itself is not deleted and
 * its stored content is not rewritten, only what the read path resolves one
 * field of it to. `entries:update` is the claim that already governs an
 * entry's resolved content changing under a caller who did not write it.
 *
 * Unlike its three siblings the *reach* here is **data-derived** rather than a
 * fixed shape the route already knows — which scopes it reaches depends on
 * who currently refers to the assets being deleted, not on the route's own
 * parameters — so it is computed at the call site
 * (`RouteAuth.requireForcedMediaDelete`) rather than named here.
 */
export class MediaForceDeletePermissions {
  static readonly All: readonly CollectionPermission[] = [ClaimVocabulary.CollectionEntriesUpdate];
}
