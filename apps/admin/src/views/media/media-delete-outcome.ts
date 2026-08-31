import type { MediaAsset } from '../../api/types/media-asset'
import type { MediaBulkDeleteFailure, MediaBulkDeleteResult } from '../../api/types/media-bulk-delete'

/** One in-use failure, with the filename `POST /api/media/delete` does not
 *  carry back — the confirm dialog already held it. */
export interface MediaInUseAsset {
  id: string
  filename: string
  usage_count: number
  visible_count: number
  visible_capped: boolean
  referrers: NonNullable<MediaBulkDeleteFailure['referrers']>
}

/**
 * The pure half of the two-dialog delete flow: what a bulk delete result
 * means for what the UI shows next.
 *
 * Kept apart from the dialogs and the hook that drives them so the decision
 * — one dialog when nothing was in use, a second when something was — is
 * testable without a DOM.
 */
export class MediaDeleteOutcome {
  /** `media_in_use` failures split from the rest: only these ask for a second
   *  dialog and an opt-in force pass. */
  static classify(result: MediaBulkDeleteResult): {
    inUse: MediaBulkDeleteFailure[]
    otherFailures: MediaBulkDeleteFailure[]
  } {
    const inUse = result.failed.filter((failure) => failure.code === 'media_in_use')
    const otherFailures = result.failed.filter((failure) => failure.code !== 'media_in_use')
    return { inUse, otherFailures }
  }

  /** Denormalizes `media_in_use` failures against the assets the confirm
   *  dialog was showing, for the second dialog to render. */
  static withFilenames(failures: MediaBulkDeleteFailure[], assets: MediaAsset[]): MediaInUseAsset[] {
    const names = new Map(assets.map((asset) => [asset.id, asset.filename]))
    return failures.map((failure) => ({
      id: failure.id,
      filename: names.get(failure.id) ?? failure.id,
      usage_count: failure.usage_count ?? 0,
      visible_count: failure.visible_count ?? 0,
      visible_capped: failure.visible_capped ?? false,
      referrers: failure.referrers ?? [],
    }))
  }
}
