import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/silo-api'
import type { Collection } from '../api/types/collection'
import type { ScopeRef } from '../api/types/scope-ref'
import type { SessionInfo } from '../api/types/session-info'

/**
 * The connection the workspace shell is built on: the verified key, the
 * server's version, and the collection list every view navigates.
 *
 * A key can be revoked between page loads, so verification happens here and a
 * failure disconnects rather than leaving a shell with nothing behind it.
 */
export function useWorkspaceSession(
  url: string,
  apiKey: string,
  scope: ScopeRef,
  onDisconnect: () => void,
) {
  const [ready, setReady] = useState(false)
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null)
  const [version, setVersion] = useState('')
  const [collections, setCollections] = useState<Collection[]>([])
  const [counts, setCounts] = useState<Record<string, number | null>>({})

  const loadCounts = useCallback(
    async (loaded: Collection[]) => {
      const totals = await Promise.all(
        loaded.map(async (collection) => {
          try {
            const page = await api.entries.list(url, apiKey, scope, collection.name, {
              limit: 1,
            })
            return [collection.name, page.total] as const
          } catch {
            return [collection.name, null] as const
          }
        }),
      )
      setCounts(Object.fromEntries(totals))
    },
    [url, apiKey, scope.project, scope.env],
  )

  const refreshCollections = useCallback(async () => {
    const loaded = await api.collections.list(url, apiKey, scope)
    setCollections(loaded)
    loadCounts(loaded)
    return loaded
  }, [url, apiKey, scope.project, scope.env, loadCounts])

  useEffect(() => {
    let alive = true
    setReady(false)

    const connect = async () => {
      try {
        const verified = await api.session.verify(url, apiKey)
        if (!alive) return
        if (!verified.ok || !verified.session) {
          onDisconnect()
          return
        }
        setSessionInfo(verified.session)

        try {
          const health = await api.session.health(url)
          if (alive) setVersion(health.version || '')
        } catch {
          /* health is unauthenticated; ignore a transient failure */
        }

        await refreshCollections()
      } catch {
        if (alive) onDisconnect()
      } finally {
        if (alive) setReady(true)
      }
    }

    connect()
    return () => {
      alive = false
    }
  }, [url, apiKey, refreshCollections, onDisconnect])

  return {
    ready,
    sessionInfo,
    claims: sessionInfo?.claims || [],
    version,
    collections,
    counts,
    refreshCollections,
    refreshCounts: () => loadCounts(collections),
  }
}
