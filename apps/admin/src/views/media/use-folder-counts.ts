import { useEffect, useState } from 'react'
import { api } from '../../api/silo-api'
import { MediaPath } from './media-path'

/**
 * How many items each subfolder on screen holds, keyed by path.
 *
 * One count-only request per *visible* subfolder (`limit: 0`, so the server
 * answers with a total and no rows), plus that subfolder's own subfolder count
 * read straight off the folder list already fetched. Never the whole tree: a
 * library with a deep hierarchy would otherwise pay for every level to render
 * one.
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

    let alive = true
    Promise.all(
      visible.map((path) =>
        api.media
          .list(url, apiKey, { folder: path, recursive: false, limit: 0 })
          .then((page): [string, number] => [
            path,
            page.total + MediaPath.children(folders, path).length,
          ])
          .catch((): [string, number] => [path, MediaPath.children(folders, path).length]),
      ),
    ).then((entries) => {
      if (alive) setCounts(Object.fromEntries(entries))
    })

    return () => {
      alive = false
    }
  }, [url, apiKey, folders, folder])

  return counts
}
