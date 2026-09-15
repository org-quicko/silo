import { Claims } from '@silo/shared/claims'
import type { MediaInUseAsset } from './media-delete-outcome'

/**
 * Whether an operation that changes what a media reference resolves to may be
 * offered: the force checkbox in `AssetInUseDialog` (D49), and the Replace
 * action (D67). Mirrors the server's own rule
 * (`RouteAuth.requireMediaContentAuthority`) — either additionally needs
 * `entries:update` on every scope an asset is actually referenced from.
 *
 * One class for both because it is one rule. Replace reaches it from the
 * asset's own usage page rather than from a refused delete, which is a
 * difference in where the referrer facts come from and in nothing else.
 *
 * `forced-delete-permissions.ts` states the principle this exists for: the
 * admin UI gates its delete buttons on exactly what the routes enforce, so an
 * affordance the server will refuse is worse than no affordance.
 *
 * `visible_count` is the true count of readable referrers (D49 audit fix —
 * it used to be how many fit on one page, which made `visible_count <
 * usage_count` true for any asset with more referrers than a page holds,
 * readable or not). `visible_capped` is checked on its own rather than
 * folded into that comparison: past the server's enumeration cap
 * `visible_count` is a lower bound, not an exact count, and the gate must
 * refuse on purpose there, not by accident of `visible_count` falling short.
 */
export class MediaContentAvailability {
  /** `null` when the operation may be offered; otherwise the reason to show
   *  in its place. Checked over every asset the call would cover at once —
   *  one `POST /api/media/delete` forces all of them together, so one missing
   *  scope makes the whole batch unavailable. A replace passes a list of one,
   *  which is the same rule with nothing to batch. */
  static unavailable(assets: readonly MediaInUseAsset[], claims: readonly string[]): string | null {
    // Root covers every check below by construction (`Claims.has` already
    // short-circuits on it) — stated explicitly so this holds even if
    // `visible_count` and `usage_count` ever disagree for a root caller,
    // which the server does not produce but this must not depend on.
    if (Claims.has(claims, Claims.Root)) return null

    for (const asset of assets) {
      if (asset.visible_capped) {
        return 'This key cannot enumerate every entry that references these files.'
      }
      if (asset.visible_count < asset.usage_count) {
        return 'This key cannot see every entry that references these files.'
      }
      for (const referrer of asset.referrers) {
        const claim = Claims.collection(
          referrer.project,
          referrer.env,
          referrer.collection,
          Claims.CollectionEntriesUpdate,
        )
        if (!Claims.has(claims, claim)) {
          return `This key lacks ${Claims.CollectionEntriesUpdate} in ${referrer.project}/${referrer.env}.`
        }
      }
    }
    return null
  }
}
