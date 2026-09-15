import { ClaimVocabulary } from "./claim-vocabulary";
import type { CollectionPermission } from "./collection-permission";

/**
 * The collection permission a media operation that changes what a reference
 * *resolves to* exercises, at whatever scopes it actually reaches (D49, D67).
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
 * D67 is the fifth, and is why this is named for the *effect* rather than for
 * force-delete, which used to be the only operation with it. Replacing an
 * asset's bytes rewrites no entry either and changes what every reference
 * resolves to in exactly the same way — to a different file rather than to
 * `null`. It is the **less** visible of the two: a force-delete surfaces as a
 * broken field, a replace as a field that still works and shows something
 * else. Gating the quieter operation more loosely than the loud one is the
 * inversion this class exists to prevent.
 *
 * `entries:update`, not `entries:delete`: the entry itself is not deleted and
 * its stored content is not rewritten, only what the read path resolves one
 * field of it to. `entries:update` is the claim that already governs an
 * entry's resolved content changing under a caller who did not write it.
 *
 * Unlike its siblings the *reach* here is **data-derived** rather than a
 * fixed shape the route already knows — which scopes it reaches depends on
 * who currently refers to the assets being changed, not on the route's own
 * parameters — so it is computed at the call site
 * (`RouteAuth.requireMediaContentAuthority`) rather than named here.
 */
export class MediaContentPermissions {
  static readonly All: readonly CollectionPermission[] = [ClaimVocabulary.CollectionEntriesUpdate];
}
