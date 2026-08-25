import { useEffect, useState } from 'react'
import { api } from '../../api/silo-api'
import type { Collection } from '../../api/types/collection'
import type { ScopeRef } from '../../api/types/scope-ref'

/**
 * What every settings page needs to know about the connection: who the key is,
 * what the server's version is, and what the resolved scope holds.
 *
 * A failure here is deliberately silent — the Connection page's diagnostics are
 * where a broken connection is meant to be reported, and a settings shell that
 * threw would take that page down with it.
 */
export function useSettingsSession(url: string, apiKey: string, scope: ScopeRef | null) {
  const [claims, setClaims] = useState<string[]>([])
  const [label, setLabel] = useState('')
  const [keyPrefix, setKeyPrefix] = useState('')
  const [version, setVersion] = useState('')
  const [collections, setCollections] = useState<Collection[]>([])

  useEffect(() => {
    let alive = true
    Promise.all([api.session.health(url), api.session.get(url, apiKey)])
      .then(([health, session]) => {
        if (!alive) return
        setVersion(health.version || '')
        setClaims(session.claims || [])
        setLabel(session.label || '')
        setKeyPrefix(session.prefix || '')
      })
      .catch(() => {
        /* surfaced by the Connection page's diagnostics */
      })

    return () => {
      alive = false
    }
  }, [url, apiKey])

  // The key form and the archive panels both need to know what the resolved
  // scope actually holds; without a scope in the URL they were handed an empty
  // list and a zero.
  useEffect(() => {
    if (!scope) {
      setCollections([])
      return
    }

    let alive = true
    api.collections
      .list(url, apiKey, scope)
      .then((items) => alive && setCollections(items))
      .catch(() => alive && setCollections([]))

    return () => {
      alive = false
    }
  }, [url, apiKey, scope?.project, scope?.env])

  return {
    claims,
    label,
    keyPrefix,
    version,
    collections,
    /** What every `SmartSearch` on these pages offers its `@`-mention popup. */
    smartCollections: collections.map((collection) => ({
      name: collection.name,
      count: null,
      schema: collection.schema,
    })),
  }
}
