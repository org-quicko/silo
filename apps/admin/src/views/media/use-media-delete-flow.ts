import { useState } from 'react'
import type { MediaAsset } from '../../api/types/media-asset'
import type { MediaBulkDeleteResult } from '../../api/types/media-bulk-delete'
import { MediaDeleteOutcome, type MediaInUseAsset } from './media-delete-outcome'

/** What `start`/`startFolder`/`startMixed` are deleting. A discriminated
 *  union so `confirm`/`forceDelete` stay one implementation each, and the
 *  same two dialogs (`DeleteAssetDialog`, `AssetInUseDialog`) render every
 *  kind rather than a dialog pair per kind (D49). `mixed` is a selection that
 *  spans both files and folders — the list-view "select all" and the grid's
 *  per-tile checkboxes let either be picked alongside the other. */
export type DeleteSubject =
  | { kind: 'assets'; assets: MediaAsset[] }
  | { kind: 'folder'; path: string }
  | { kind: 'mixed'; assets: MediaAsset[]; folderPaths: string[] }

function mergeResults(results: MediaBulkDeleteResult[]): MediaBulkDeleteResult {
  return {
    deleted: results.flatMap((result) => result.deleted),
    failed: results.flatMap((result) => result.failed),
  }
}

/**
 * Drives the two-dialog delete flow, so a file selection, a recursive folder
 * delete, and a selection spanning both share one path.
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
  /** Fired once, right before the flow closes with everything gone — never
   *  on the still-in-use branch, since that isn't done yet. */
  onDeleted?: (subject: DeleteSubject) => void,
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

  const startMixed = (assets: MediaAsset[], folderPaths: string[]) => {
    setSubject({ kind: 'mixed', assets, folderPaths })
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
          : subject.kind === 'mixed'
            ? mergeResults(
                await Promise.all([
                  bulkDelete(
                    subject.assets.map((asset) => asset.id),
                    false,
                  ),
                  ...subject.folderPaths.map((path) => deleteFolder(path, false)),
                ]),
              )
            : await bulkDelete(subject.assets.map((asset) => asset.id), false)

      const { inUse: stillInUse } = MediaDeleteOutcome.classify(result)
      if (stillInUse.length === 0) {
        onDeleted?.(subject)
        cancel()
        return
      }
      // A folder subject has no pre-fetched asset list to denormalize a
      // filename from, so every failure falls back to showing its raw id —
      // the same fallback an unknown id already takes in the asset case. A
      // mixed subject can denormalize its own assets, but not what a
      // selected folder held.
      const named = subject.kind === 'folder' ? [] : subject.assets
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
      } else if (subject.kind === 'mixed') {
        await Promise.all([
          bulkDelete(
            inUse.map((failure) => failure.id),
            true,
          ),
          ...subject.folderPaths.map((path) => deleteFolder(path, true)),
        ])
      } else {
        await bulkDelete(
          inUse.map((failure) => failure.id),
          true,
        )
      }
      onDeleted?.(subject)
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
    startMixed,
    cancel,
    confirm,
    forceDelete,
  }
}
