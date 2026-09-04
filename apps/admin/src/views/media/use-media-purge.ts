import { useState } from 'react'
import type { MediaFolderDeleteResult } from '../../api/types/media-folder-delete'
import { MediaDeleteOutcome } from './media-delete-outcome'

/**
 * Drives `PurgeLibraryDialog`: whether it is open, whether a purge request is
 * in flight, and the one-line error a partial purge leaves behind.
 *
 * Split out of `MediaLibraryView` (D49 audit fix) on the same reasoning
 * `useMediaDeleteFlow` already exists for — purge is a self-contained flow
 * with a dialog and a busy/error pair of its own, not page state. Purge has
 * one dialog, not the confirm-then-in-use pair `useMediaDeleteFlow` drives,
 * so a still-referenced file is reported right here rather than opening a
 * second dialog for it.
 */
export function useMediaPurge(purge: (force: boolean) => Promise<MediaFolderDeleteResult>, onPurged?: () => void) {
  const [purging, setPurging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const start = () => {
    setPurging(true)
    setError('')
  }

  const cancel = () => setPurging(false)

  const confirm = async (force: boolean) => {
    setBusy(true)
    setError('')
    try {
      const result = await purge(force)
      const { inUse } = MediaDeleteOutcome.classify(result)
      if (inUse.length === 0) {
        setPurging(false)
        onPurged?.()
        return
      }
      setError(
        force
          ? `${inUse.length} file${inUse.length === 1 ? ' could' : 's could'} not be forced. See the banners above.`
          : `${inUse.length} file${inUse.length === 1 ? ' is' : 's are'} still referenced. Check the box above and purge again to delete them anyway.`,
      )
    } finally {
      setBusy(false)
    }
  }

  return { purging, busy, error, start, cancel, confirm }
}
