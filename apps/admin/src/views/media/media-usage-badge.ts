import type { MediaAsset } from '../../api/types/media-asset'

/** What the badge under a thumbnail says, and why. */
export class MediaUsageBadge {
  static label(asset: MediaAsset): string {
    if (asset.state === 'deleting') return 'stuck deleting'

    const used = asset.usage_count || 0
    return used > 0 ? `in use · ${used}` : 'unused'
  }

  static title(asset: MediaAsset): string {
    if (asset.state === 'deleting') {
      return 'Staged for deletion but its file could not be removed. Run "silo media reconcile".'
    }

    const used = asset.usage_count || 0
    if (used === 0) return 'Not referenced by any entry'
    return `Referenced by ${used} entr${used === 1 ? 'y' : 'ies'} — cannot be deleted`
  }
}
