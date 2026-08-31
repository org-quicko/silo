import { useCallback, useEffect, useState } from 'react'
import { api } from '../../api/silo-api'
import type { MediaAsset } from '../../api/types/media-asset'
import type { MediaBulkDeleteResult } from '../../api/types/media-bulk-delete'
import { MediaDeleteOutcome } from './media-delete-outcome'
import { MediaPath } from './media-path'

/** How many assets one page of the grid holds. */
export const MediaPageSize = 48

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
  const [folders, setFolders] = useState<string[]>([])
  const [folder, setFolder] = useState('')
  /** Item count per visible subfolder — direct children only, fetched only
   *  for the folders on screen, not the whole tree. */
  const [folderCounts, setFolderCounts] = useState<Record<string, number>>({})
  const [search, setSearch] = useState(initialQuery)
  const [query, setQuery] = useState(initialQuery)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  /** Set when the blob store refused a delete: the asset is staged, not gone. */
  const [stalled, setStalled] = useState('')
  /** Set when a bulk delete's per-id outcomes include a `not_found` or
   *  `invalid_id` failure — on the same pattern as `stalled`, a state
   *  `reload` never clears, so the message survives the reload a successful
   *  delete in the same batch triggers. */
  const [deleteIssues, setDeleteIssues] = useState('')
  /** Asset ids selected for a bulk operation. Assets only — folders are never
   *  selectable, since folder delete is a separate, empty-folder-only route. */
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const clearSelection = useCallback(() => setSelected(new Set()), [])

  // Selection clears on folder change, page change and query change — it
  // names rows on the page being left, not ones on the page being entered.
  // Reset during render (React's documented pattern for state derived from
  // other state) rather than in an effect, which would cost an extra commit
  // for a set-state-in-effect lint has no way to know is unavoidable here.
  const [selectionKey, setSelectionKey] = useState({ folder, offset, query })
  if (selectionKey.folder !== folder || selectionKey.offset !== offset || selectionKey.query !== query) {
    setSelectionKey({ folder, offset, query })
    setSelected(new Set())
  }

  const reload = useCallback(() => {
    setLoading(true)
    Promise.all([
      api.media.list(url, apiKey, {
        q: query || undefined,
        folder,
        recursive: false,
        limit: MediaPageSize,
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
  }, [url, apiKey, query, folder, offset])

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

  // One count-only request per subfolder on screen (limit 0 — just the
  // total), plus each subfolder's own subfolder count read straight off the
  // list already fetched. Never the whole tree, only what's rendered here.
  useEffect(() => {
    const visible = MediaPath.children(folders, folder)
    if (visible.length === 0) return
    let alive = true
    Promise.all(
      visible.map((path) =>
        api.media
          .list(url, apiKey, { folder: path, recursive: false, limit: 0 })
          .then((page): [string, number] => [path, page.total + MediaPath.children(folders, path).length])
          .catch((): [string, number] => [path, MediaPath.children(folders, path).length]),
      ),
    ).then((entries) => {
      if (alive) setFolderCounts(Object.fromEntries(entries))
    })
    return () => {
      alive = false
    }
  }, [url, apiKey, folders, folder])

  const selectFolder = (next: string) => {
    setFolder(next)
    setOffset(0)
  }

  return {
    assets,
    total,
    offset,
    setOffset,
    folder,
    subfolders,
    folderCounts,
    selectFolder,
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
    selected,
    clearSelection,

    toggleSelected: (id: string) => {
      setSelected((prev) => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
    },

    /** The header checkbox in list view: selects or clears every id given —
     *  the current page's assets, never a folder. */
    selectMany: (ids: string[], on: boolean) => {
      setSelected((prev) => {
        const next = new Set(prev)
        for (const id of ids) {
          if (on) next.add(id)
          else next.delete(id)
        }
        return next
      })
    },

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
      } catch (failure: unknown) {
        setError(MediaLibraryError.message(failure, 'Could not create the folder'))
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
        const { otherFailures } = MediaDeleteOutcome.classify(result)
        const stalledCount = otherFailures.filter((failure) => failure.code === 'media_delete_stalled').length
        const notFoundCount = otherFailures.filter((failure) => failure.code === 'not_found').length
        const invalidCount = otherFailures.filter((failure) => failure.code === 'invalid_id').length
        if (stalledCount > 0) setStalled(MediaLibraryError.stalledMessage(stalledCount))
        if (notFoundCount > 0 || invalidCount > 0) {
          setDeleteIssues(MediaLibraryError.deleteIssuesMessage(notFoundCount, invalidCount))
        }
        if (result.deleted.length > 0) {
          clearSelection()
          reload()
        }
        return result
      } catch (failure: unknown) {
        setError(MediaLibraryError.message(failure, 'Delete failed'))
        return { deleted: [], failed: [] }
      }
    },
  }
}

/** One place that decides what a failed media call says. */
class MediaLibraryError {
  static message(failure: unknown, fallback: string): string {
    return failure instanceof Error ? failure.message : fallback
  }

  static stalledMessage(count: number): string {
    const file = count === 1 ? 'file is' : 'files are'
    return `${count} ${file} staged for deletion but could not be removed from storage. Run "silo media reconcile".`
  }

  /** Covers both `not_found` and `invalid_id`: neither is a storage
   *  problem, so neither belongs in `stalled`, and both survive a reload
   *  the same way. */
  static deleteIssuesMessage(notFound: number, invalid: number): string {
    const parts: string[] = []
    if (notFound > 0) parts.push(`${notFound} ${notFound === 1 ? 'file was' : 'files were'} already gone`)
    if (invalid > 0) parts.push(`${invalid} ${invalid === 1 ? 'id was' : 'ids were'} invalid`)
    return `${parts.join(' and ')}; not deleted.`
  }
}
