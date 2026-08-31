import { useState } from 'react'
import type { MediaAsset } from '../../api/types/media-asset'
import type { MediaBulkDeleteResult } from '../../api/types/media-bulk-delete'
import { MediaDeleteOutcome, type MediaInUseAsset } from './media-delete-outcome'

/** What `start`/`startFolder` are deleting. A discriminated union so
 *  `confirm`/`forceDelete` stay one implementation each, and the same two
 *  dialogs (`DeleteAssetDialog`, `AssetInUseDialog`) render either kind
 *  rather than a second dialog pair existing just for folders (D49). */
export type DeleteSubject = { kind: 'assets'; assets: MediaAsset[] } | { kind: 'folder'; path: string }

/**
 * Drives the two-dialog delete flow, so a file selection and a recursive
 * folder delete share one path.
 *
 * Case A, nothing selected is in use: `confirm` deletes and the flow ends —
 * one dialog. Case B, something is: the confirm dialog is replaced by the
 * "still in use" one (`MediaLibraryView` renders it once `inUse` is set), and
 * `forceDelete` retries, forced, with no dialog after it. `subject` is kept
 * around rather than cleared at that point — the folder case needs its path
 * again, and the asset case retries only `inUse`'s ids rather than the
 * original selection, so an id the first pass already deleted is never
 * re-asked about. Reload/banner/selection side effects live in
 * `useMediaLibrary`; this hook only decides which dialog is showing.
 */
export function useMediaDeleteFlow(
  bulkDelete: (ids: string[], force: boolean) => Promise<MediaBulkDeleteResult>,
  deleteFolder: (path: string, force: boolean) => Promise<MediaBulkDeleteResult>,
) {
  const [subject, setSubject] = useState<DeleteSubject | null>(null)
  const [inUse, setInUse] = useState<MediaInUseAsset[] | null>(null)
  const [forceChecked, setForceChecked] = useState(false)
  const [busy, setBusy] = useState(false)

  const start = (assets: MediaAsset[]) => {
    setSubject({ kind: 'assets', assets })
    setInUse(null)
    setForceChecked(false)
  }

  const startFolder = (path: string) => {
    setSubject({ kind: 'folder', path })
    setInUse(null)
    setForceChecked(false)
  }

  const cancel = () => {
    setSubject(null)
    setInUse(null)
    setForceChecked(false)
  }

  const confirm = async () => {
    if (!subject) return
    setBusy(true)
    try {
      const result =
        subject.kind === 'folder'
          ? await deleteFolder(subject.path, false)
          : await bulkDelete(subject.assets.map((asset) => asset.id), false)

      const { inUse: stillInUse } = MediaDeleteOutcome.classify(result)
      if (stillInUse.length === 0) {
        cancel()
        return
      }
      // A folder subject has no pre-fetched asset list to denormalize a
      // filename from, so every failure falls back to showing its raw id —
      // the same fallback an unknown id already takes in the asset case.
      const named = subject.kind === 'assets' ? subject.assets : []
      setInUse(MediaDeleteOutcome.withFilenames(stillInUse, named))
    } finally {
      setBusy(false)
    }
  }

  const forceDelete = async () => {
    if (!inUse || !subject) return
    setBusy(true)
    try {
      if (subject.kind === 'folder') {
        // Recursion re-scans the folder from scratch, so it naturally covers
        // exactly what is still there — everything the first pass already
        // removed is simply no longer found.
        await deleteFolder(subject.path, true)
      } else {
        await bulkDelete(
          inUse.map((failure) => failure.id),
          true,
        )
      }
      cancel()
    } finally {
      setBusy(false)
    }
  }

  return {
    subject,
    inUse,
    forceChecked,
    setForceChecked,
    busy,
    start,
    startFolder,
    cancel,
    confirm,
    forceDelete,
  }
}
