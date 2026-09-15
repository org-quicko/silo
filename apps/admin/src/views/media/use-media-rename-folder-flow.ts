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
 *
 * Any other refusal is `error`, which the open dialog shows: the flow keeps
 * it rather than letting it land in the page banner behind the dialog that
 * asked for it.
 */
export function useMediaRenameFolderFlow(
  renameFolder: (from: string, to: string, merge: boolean) => Promise<RenameFolderOutcome>,
  onRenamed?: () => void,
) {
  const [path, setPath] = useState<string | null>(null)
  const [mergeOffer, setMergeOffer] = useState<{ from: string; to: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const start = (folderPath: string) => {
    setPath(folderPath)
    setMergeOffer(null)
    setError('')
  }

  const cancel = () => {
    setPath(null)
    setMergeOffer(null)
    setError('')
  }

  const save = async (to: string) => {
    if (!path) return
    setBusy(true)
    setError('')
    try {
      const outcome = await renameFolder(path, to, false)
      if (MediaRenameOutcome.closes(outcome)) {
        onRenamed?.()
        cancel()
        return
      }
      setMergeOffer(MediaRenameOutcome.mergeOffer(outcome, path, to))
      setError(MediaRenameOutcome.message(outcome))
    } finally {
      setBusy(false)
    }
  }

  const confirmMerge = async () => {
    if (!mergeOffer) return
    setBusy(true)
    setError('')
    try {
      const outcome = await renameFolder(mergeOffer.from, mergeOffer.to, true)
      if (MediaRenameOutcome.closes(outcome)) {
        onRenamed?.()
        cancel()
        return
      }
      setError(MediaRenameOutcome.message(outcome))
    } finally {
      setBusy(false)
    }
  }

  return { path, mergeOffer, busy, error, start, cancel, save, confirmMerge }
}
