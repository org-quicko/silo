import { useCallback, useEffect, useState } from 'react'
import { ApiError } from '../../api/api-error'
import { api } from '../../api/silo-api'
import type { MediaAsset } from '../../api/types/media-asset'
import type { MediaBulkDeleteResult } from '../../api/types/media-bulk-delete'
import type { MediaFolderDeleteResult } from '../../api/types/media-folder-delete'
import { MediaDeleteOutcome } from './media-delete-outcome'
import type { ModifiedRange } from './media-modified-presets'
import { MediaPath } from './media-path'
import { useMediaSelection } from './use-media-selection'
import { useFolderCounts } from './use-folder-counts'
import { MediaLibraryError } from './media-library-error'

/** How many assets one page of the grid holds by default, until the reader
 *  picks a different row count from the pagination bar. Matches one of
 *  `Pagination`'s preset options, so the dropdown starts in step with what
 *  actually loaded rather than falling back to its first option. */
export const MediaDefaultPageSize = 50

/** What a folder rename attempt did: saved, refused on a collision at `to`
 *  (the one outcome `useMediaRenameFolderFlow` turns into a merge offer), or
 *  failed some other way (already reported through `error`). */
export type RenameFolderOutcome = 'ok' | 'conflict' | 'error'

/**
 * The library's contents and the operations that change them.
 *
 * `folder` is where the browser currently is, one level at a time — a
 * directory, not a filter. Listing it is non-recursive: what dropped the
 * subtree-wide search (D23's original "no broken filter" reasoning) is that
 * subfolders now render as their own tiles here rather than disappearing, so
 * a folder's *own* files are exactly what "inside it" should show.
 */
export function useMediaLibrary(url: string, apiKey: string, initialQuery: string) {
  const [assets, setAssets] = useState<MediaAsset[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [pageSize, setPageSizeState] = useState(MediaDefaultPageSize)
  const [folders, setFolders] = useState<string[]>([])
  const [folder, setFolder] = useState('')
  const [search, setSearch] = useState(initialQuery)
  const [query, setQuery] = useState(initialQuery)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [extensions, setExtensions] = useState<string[]>([])
  const [ext, setExtState] = useState('')
  const [modified, setModifiedState] = useState<ModifiedRange | null>(null)
  /** Set when the blob store refused a delete: the asset is staged, not gone. */
  const [stalled, setStalled] = useState('')
  /** Set when a bulk delete's per-id outcomes include a `not_found` or
   *  `invalid_id` failure — on the same pattern as `stalled`, a state
   *  `reload` never clears, so the message survives the reload a successful
   *  delete in the same batch triggers. */
  const [deleteIssues, setDeleteIssues] = useState('')
  // Selection lives in its own hook (D49 audit fix) — this hook already does
  // list state and delete orchestration, and selection is a third concern
  // with its own page-boundary reset rule.
  const selection = useMediaSelection(JSON.stringify([folder, offset, query, ext, modified]))

  const reload = useCallback(() => {
    setLoading(true)
    Promise.all([
      api.media.list(url, apiKey, {
        q: query || undefined,
        folder,
        recursive: false,
        ext: ext || undefined,
        modifiedAfter: modified?.after,
        modifiedBefore: modified?.before,
        limit: pageSize,
        offset,
      }),
      api.media.listFolders(url, apiKey),
    ])
      .then(([page, folderList]) => {
        setAssets(page.items)
        setTotal(page.total)
        setFolders(folderList)
        setError('')
      })
      .catch((failure: unknown) => {
        setAssets([])
        setTotal(0)
        setError(MediaLibraryError.message(failure, 'Could not load the media library'))
      })
      .finally(() => setLoading(false))
  }, [url, apiKey, query, folder, ext, modified, offset, pageSize])

  // The Type filter's menu, fetched once per server connection rather than
  // on every reload — what extensions exist changes far less often than what
  // page or folder is showing.
  useEffect(() => {
    api.media.listExtensions(url, apiKey).then(setExtensions).catch(() => setExtensions([]))
  }, [url, apiKey])

  useEffect(reload, [reload])

  // The library stays mounted while the URL changes underneath it, so a second
  // arrival from the palette has to be adopted rather than ignored.
  useEffect(() => {
    setSearch(initialQuery)
    setQuery(initialQuery)
    setOffset(0)
  }, [initialQuery])

  // Debounced so typing pages the server once per pause, not once per key.
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search.trim())
      setOffset(0)
    }, 250)
    return () => clearTimeout(timer)
  }, [search])

  const subfolders = MediaPath.children(folders, folder)

  // Counts for the subfolders on screen, fetched there rather than here:
  // they are derived from what is rendered, not part of this hook's state.
  const folderCounts = useFolderCounts(url, apiKey, folders, folder)

  const selectFolder = (next: string) => {
    setFolder(next)
    setOffset(0)
  }

  const setPageSize = (next: number) => {
    setPageSizeState(next)
    setOffset(0)
  }

  const setExt = (next: string) => {
    setExtState(next)
    setOffset(0)
  }

  const setModified = (next: ModifiedRange | null) => {
    setModifiedState(next)
    setOffset(0)
  }

  /** The `stalled`/`deleteIssues` banners `bulkDelete`, `deleteFolderRecursive`
   *  and `purge` all report the same way, off the same `{deleted, failed}`
   *  shape (D49). */
  const reportOutcome = (result: MediaBulkDeleteResult): void => {
    const { otherFailures } = MediaDeleteOutcome.classify(result)
    const stalledCount = otherFailures.filter((failure) => failure.code === 'media_delete_stalled').length
    const notFoundCount = otherFailures.filter((failure) => failure.code === 'not_found').length
    const invalidCount = otherFailures.filter((failure) => failure.code === 'invalid_id').length
    if (stalledCount > 0) setStalled(MediaLibraryError.stalledMessage(stalledCount))
    if (notFoundCount > 0 || invalidCount > 0) {
      setDeleteIssues(MediaLibraryError.deleteIssuesMessage(notFoundCount, invalidCount))
    }
  }

  return {
    assets,
    total,
    offset,
    setOffset,
    pageSize,
    setPageSize,
    folder,
    subfolders,
    folderCounts,
    selectFolder,
    extensions,
    ext,
    setExt,
    modified,
    setModified,
    query,
    loading,
    uploading,
    error,
    setError,
    stalled,
    setStalled,
    deleteIssues,
    setDeleteIssues,
    reload,
    selected: selection.selected,
    selectedFolders: selection.selectedFolders,
    clearSelection: selection.clearSelection,
    toggleSelected: selection.toggleSelected,
    toggleFolderSelected: selection.toggleFolderSelected,
    selectAllOnPage: selection.selectAllOnPage,

    upload: async (files: FileList) => {
      if (files.length === 0) return
      setUploading(true)
      try {
        for (const file of Array.from(files)) {
          await api.media.upload(url, apiKey, file, folder || undefined)
        }
        reload()
      } catch (failure: unknown) {
        setError(MediaLibraryError.message(failure, 'Upload failed'))
      } finally {
        setUploading(false)
      }
    },

    rename: async (id: string, filename: string, nextFolder: string) => {
      try {
        await api.media.update(url, apiKey, id, { filename, folder: nextFolder })
        reload()
        return true
      } catch (failure: unknown) {
        setError(MediaLibraryError.message(failure, 'Could not save'))
        return false
      }
    },

    createFolder: async (path: string) => {
      try {
        const created = await api.media.createFolder(url, apiKey, path)
        selectFolder(created.path)
        return true
      } catch (failure: unknown) {
        setError(MediaLibraryError.message(failure, 'Could not create the folder'))
        return false
      }
    },

    /** Rename or move a folder (D49). Navigates along if the folder being
     *  browsed was renamed or moved out from under the browser.
     *
     *  A collision at `to` without `merge` reports `'conflict'` rather than
     *  setting `error` — `useMediaRenameFolderFlow` is what turns that into
     *  the merge offer, so it must not also land in the generic banner. */
    renameFolder: async (from: string, to: string, merge = false): Promise<RenameFolderOutcome> => {
      try {
        const result = await api.media.renameFolder(url, apiKey, from, to, merge)
        reload()
        if (folder === result.from) selectFolder(result.to)
        else if (folder.startsWith(result.from + '/')) selectFolder(result.to + folder.slice(result.from.length))
        return 'ok'
      } catch (failure: unknown) {
        if (!merge && failure instanceof ApiError && failure.status === 409) return 'conflict'
        setError(MediaLibraryError.message(failure, 'Could not rename the folder'))
        return 'error'
      }
    },

    /**
     * The one delete path — a single-file trash click is a list of one id,
     * same as a multi-select. Always answers `200` with per-id outcomes
     * (D48): `media_in_use` ones are for `useMediaDeleteFlow` to turn into
     * the second dialog. `not_found` and `invalid_id` set `deleteIssues`,
     * `media_delete_stalled` sets `stalled` — both a state `reload` never
     * touches, so a `reload()` a few lines down (triggered by whatever *did*
     * delete in the same batch) cannot wipe the message before it is read.
     */
    bulkDelete: async (ids: string[], force: boolean): Promise<MediaBulkDeleteResult> => {
      try {
        const result = await api.media.deleteMany(url, apiKey, ids, force)
        reportOutcome(result)
        if (result.deleted.length > 0) {
          selection.clearSelection()
          reload()
        }
        return result
      } catch (failure: unknown) {
        setError(MediaLibraryError.message(failure, 'Delete failed'))
        return { deleted: [], failed: [] }
      }
    },

    /** Recursive folder delete (D49): the same per-id outcome banners as
     *  `bulkDelete`. `folders_deleted > 0` is the honest signal the folder
     *  is actually gone — an asset a delete could not remove means it isn't,
     *  regardless of how many others succeeded — and is what decides whether
     *  the browser navigates out of it. */
    deleteFolderRecursive: async (path: string, force: boolean): Promise<MediaFolderDeleteResult> => {
      try {
        const result = await api.media.deleteFolderRecursive(url, apiKey, path, force)
        reportOutcome(result)
        if (result.deleted.length > 0) selection.clearSelection()
        if (result.folders_deleted > 0 && (folder === path || folder.startsWith(path + '/'))) {
          selectFolder(MediaPath.parent(path))
        }
        if (result.deleted.length > 0 || result.folders_deleted > 0) reload()
        return result
      } catch (failure: unknown) {
        setError(MediaLibraryError.message(failure, 'Could not delete the folder'))
        return { deleted: [], failed: [], folders_deleted: 0 }
      }
    },

    /** Empties the whole library (D49). `media_in_use` failures are this
     *  call's own concern to report — purge has one dialog, not the
     *  confirm-then-in-use pair `useMediaDeleteFlow` drives, so there is no
     *  second dialog for them to become. */
    purge: async (force: boolean): Promise<MediaFolderDeleteResult> => {
      try {
        const result = await api.media.purge(url, apiKey, force)
        reportOutcome(result)
        selection.clearSelection()
        selectFolder('')
        reload()
        return result
      } catch (failure: unknown) {
        setError(MediaLibraryError.message(failure, 'Purge failed'))
        return { deleted: [], failed: [], folders_deleted: 0 }
      }
    },
  }
}

