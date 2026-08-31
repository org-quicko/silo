import { useState } from 'react'
import type { MediaAsset } from '../../api/types/media-asset'
import type { MediaBulkDeleteResult } from '../../api/types/media-bulk-delete'
import { MediaDeleteOutcome, type MediaInUseAsset } from './media-delete-outcome'

/**
 * Drives the two-dialog delete flow over `bulkDelete`, so a single file and a
 * multi-select share one path: `start` always takes a list, one file is a
 * list of one.
 *
 * Case A, nothing selected is in use: `confirm` deletes and the flow ends —
 * one dialog. Case B, something is: the confirm dialog is replaced by the
 * "still in use" one, and `forceDelete` retries only those ids, forced, with
 * no dialog after it. `bulkDelete`'s own reload/banner/selection side effects
 * live in `useMediaLibrary`; this hook only decides which dialog is showing.
 */
export function useMediaDeleteFlow(
  bulkDelete: (ids: string[], force: boolean) => Promise<MediaBulkDeleteResult>,
) {
  const [confirming, setConfirming] = useState<MediaAsset[] | null>(null)
  const [inUse, setInUse] = useState<MediaInUseAsset[] | null>(null)
  const [forceChecked, setForceChecked] = useState(false)
  const [busy, setBusy] = useState(false)

  const start = (assets: MediaAsset[]) => {
    setConfirming(assets)
    setInUse(null)
    setForceChecked(false)
  }

  const cancel = () => {
    setConfirming(null)
    setInUse(null)
    setForceChecked(false)
  }

  const confirm = async () => {
    if (!confirming) return
    setBusy(true)
    try {
      const result = await bulkDelete(confirming.map((asset) => asset.id), false)
      const { inUse: stillInUse } = MediaDeleteOutcome.classify(result)
      if (stillInUse.length === 0) {
        cancel()
        return
      }
      setInUse(MediaDeleteOutcome.withFilenames(stillInUse, confirming))
      setConfirming(null)
    } finally {
      setBusy(false)
    }
  }

  const forceDelete = async () => {
    if (!inUse) return
    setBusy(true)
    try {
      await bulkDelete(inUse.map((failure) => failure.id), true)
      cancel()
    } finally {
      setBusy(false)
    }
  }

  return { confirming, inUse, forceChecked, setForceChecked, busy, start, cancel, confirm, forceDelete }
}
