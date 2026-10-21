import { useEffect, useState } from 'react'
import { api } from '../../api/silo-api'
import { MediaFolderCounts } from './media-folder-counts'
import { MediaPath } from './media-path'

/**
 * How many items each subfolder on screen holds, keyed by path.
 *
 * One request per *visible* subfolder, at most `MediaFolderCounts.MaxInFlight`
 * at a time, plus that subfolder's own subfolder count read straight off the
 * folder list already fetched. Never the whole tree: a library with a deep
 * hierarchy would otherwise pay for every level to render one. Each request
 * asks for `limit: 1`, the smallest page there is, since the server reads
 * `limit: 0` as its default page of 50.
 *
 * A folder whose count cannot be fetched still reports its subfolders rather
 * than nothing, so a failed request shows an undercount instead of an empty
 * folder that is not empty.
 */
export function useFolderCounts(
  url: string,
  apiKey: string,
  folders: string[],
  folder: string,
): Record<string, number> {
  const [counts, setCounts] = useState<Record<string, number>>({})

  useEffect(() => {
    const visible = MediaPath.children(folders, folder)
    if (visible.length === 0) return

    const abort = new AbortController()
    const subfolders = (path: string) => MediaPath.children(folders, path).length
    MediaFolderCounts.load(
      visible,
      (path) =>
        api.media
          .list(url, apiKey, { folder: path, recursive: false, limit: 1 })
          .then((page) => page.total + subfolders(path))
          .catch(() => subfolders(path)),
      abort.signal,
    ).then((loaded) => {
      if (!abort.signal.aborted) setCounts(loaded)
    })

    return () => abort.abort()
  }, [url, apiKey, folders, folder])

  return counts
}
