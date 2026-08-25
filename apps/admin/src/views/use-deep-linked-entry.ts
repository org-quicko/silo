import { useEffect, useState } from 'react'
import { api } from '../api/silo-api'
import type { Entry } from '../api/types/entry'
import type { ScopeRef } from '../api/types/scope-ref'
import { router } from '../router/router'
import { Routes } from '../router/routes'

/**
 * A deep link to an entry carries only its id, so the entry is fetched here
 * rather than handed down from the list.
 *
 * A stale or bad id falls back to the collection it claims to belong to — an
 * empty form would look like a new entry, which it is not.
 */
export function useDeepLinkedEntry(
  url: string,
  apiKey: string,
  scope: ScopeRef,
  serverId: string,
  collection: string | null,
  entryId: string | null,
): Entry | null {
  const [entry, setEntry] = useState<Entry | null>(null)

  useEffect(() => {
    setEntry(null)
    if (!collection || !entryId) return

    let alive = true
    api.entries
      .get(url, apiKey, scope, collection, entryId)
      .then((found) => alive && setEntry(found))
      .catch(() => {
        if (!alive) return
        router.navigate(Routes.entries(serverId, scope.project, scope.env, collection), {
          replace: true,
        })
      })

    return () => {
      alive = false
    }
  }, [url, apiKey, scope.project, scope.env, serverId, collection, entryId])

  return entry
}
