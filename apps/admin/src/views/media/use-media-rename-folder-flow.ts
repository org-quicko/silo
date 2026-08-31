import { useState } from 'react'
import { MediaRenameOutcome } from './media-rename-outcome'
import type { RenameFolderOutcome } from './use-media-library'

/**
 * Drives the folder rename dialog and the merge offer that follows a
 * collision (D49).
 *
 * A plain rename attempts first; only a `409` earns the merge offer, and
 * only `DangerConfirm`'s typed confirmation arms it, never a plain checkbox
 * — `merge: true` makes the two subtrees indistinguishable afterward, which
 * is exactly what `DangerConfirm` is reserved for. One dialog shows at a
 * time, `mergeOffer` replacing the rename dialog rather than stacking on it,
 * the same shape `useMediaDeleteFlow` already takes for its own pair.
 */
export function useMediaRenameFolderFlow(
  renameFolder: (from: string, to: string, merge: boolean) => Promise<RenameFolderOutcome>,
) {
  const [path, setPath] = useState<string | null>(null)
  const [mergeOffer, setMergeOffer] = useState<{ from: string; to: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const start = (folderPath: string) => {
    setPath(folderPath)
    setMergeOffer(null)
  }

  const cancel = () => {
    setPath(null)
    setMergeOffer(null)
  }

  const save = async (to: string) => {
    if (!path) return
    setBusy(true)
    try {
      const outcome = await renameFolder(path, to, false)
      if (MediaRenameOutcome.closes(outcome)) cancel()
      else setMergeOffer(MediaRenameOutcome.mergeOffer(outcome, path, to))
    } finally {
      setBusy(false)
    }
  }

  const confirmMerge = async () => {
    if (!mergeOffer) return
    setBusy(true)
    try {
      const outcome = await renameFolder(mergeOffer.from, mergeOffer.to, true)
      if (MediaRenameOutcome.closes(outcome)) cancel()
    } finally {
      setBusy(false)
    }
  }

  return { path, mergeOffer, busy, start, cancel, save, confirmMerge }
}
