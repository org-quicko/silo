import { useCallback, useEffect, useState } from 'react'
import { api } from '../../api/silo-api'
import { ApiError } from '../../api/api-error'
import type { MediaAsset } from '../../api/types/media-asset'
import type { MediaInUse } from '../../api/types/media-usage'
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
    reload,

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
     * Returns the referrers when the server refused because the file is still
     * in use — that refusal is the feature, so it gets a real explanation
     * rather than a generic failure.
     */
    remove: async (id: string): Promise<MediaInUse | null> => {
      try {
        await api.media.delete(url, apiKey, id)
        reload()
        return null
      } catch (failure: unknown) {
        if (failure instanceof ApiError && failure.code === 'media_in_use') {
          return failure.info as unknown as MediaInUse
        }
        if (failure instanceof ApiError && failure.code === 'media_delete_stalled') {
          setStalled(failure.message)
          reload()
          return null
        }
        setError(MediaLibraryError.message(failure, 'Delete failed'))
        return null
      }
    },
  }
}

/** One place that decides what a failed media call says. */
class MediaLibraryError {
  static message(failure: unknown, fallback: string): string {
    return failure instanceof Error ? failure.message : fallback
  }
}
