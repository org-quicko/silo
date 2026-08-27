import { useEffect, useState } from 'react'
import { MediaRef } from '@silo/shared/media-ref'
import { api } from '../../api/silo-api'
import type { Entry } from '../../api/types/entry'
import type { MediaAsset } from '../../api/types/media-asset'

/**
 * Resolves `x-silo-type: media` references in the columns on screen into
 * filenames and thumbnails — a cell must never show the stored
 * `silo://media/<ulid>` itself.
 *
 * Bounded to ids not already known, so paging or re-searching only fetches what
 * changed.
 */
export function useMediaColumns(
  url: string,
  apiKey: string,
  entries: Entry[],
  columns: string[],
): Record<string, MediaAsset> {
  const [assetsById, setAssetsById] = useState<Record<string, MediaAsset>>({})

  useEffect(() => {
    const wanted = new Set<string>()
    for (const entry of entries) {
      for (const column of columns) {
        const id = MediaRef.canonicalId(entry.data?.[column])
        if (id && !assetsById[id]) wanted.add(id)
      }
    }
    if (wanted.size === 0) return

    let alive = true
    Promise.all(
      [...wanted].map((id) =>
        api.media
          .get(url, apiKey, id)
          .then((asset) => [id, asset] as const)
          .catch(() => null),
      ),
    ).then((resolved) => {
      if (!alive) return
      const found: Record<string, MediaAsset> = {}
      for (const pair of resolved) if (pair) found[pair[0]] = pair[1]
      if (Object.keys(found).length > 0) {
        setAssetsById((current) => ({ ...current, ...found }))
      }
    })

    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, columns.join(',')])

  return assetsById
}
