import { useEffect, useRef, useState } from 'react'
import type { CollectionSummary } from '../../../api/types/collection-summary'
import type { Entry } from '../../../api/types/entry'
import type { ScopeRef } from '../../../api/types/scope-ref'
import { api } from '../../../api/silo-api'
import type { Server } from '../../servers/server'

export interface ScopeCopySearch {
  query: string
  entries: Entry[]
  loading: boolean
  error: string
  total: number
  setQuery(query: string): void
}

/** Debounced source-scope entry search with an exact-id fallback. */
export function useScopeCopySearch(server: Server, scope: ScopeRef | null, collections: CollectionSummary[]): ScopeCopySearch {
  const [query, setQuery] = useState('')
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [total, setTotal] = useState(0)
  const request = useRef(0)

  useEffect(() => { setQuery(''); setEntries([]); setLoading(false); setError(''); setTotal(0) }, [server.id, server.url, server.apiKey, scope?.project, scope?.env])

  useEffect(() => {
    const needle = query.trim()
    const ticket = ++request.current
    if (!scope || !needle) { setEntries([]); setLoading(false); setError(''); setTotal(0); return }
    let active = true
    const timer = window.setTimeout(() => {
      setLoading(true); setError('')
      api.search.run(server.url, server.apiKey, { kind: 'scope', scope }, { query: needle, limit: 6 }).then(async (page) => {
        let found = page.items.map((hit) => hit.entry)
        if (found.length === 0 && /^[0-9A-HJKMNP-TV-Z]{26}$/i.test(needle)) {
          const exact = await api.search.run(server.url, server.apiKey, { kind: 'scope', scope }, { filter: { op: 'eq', path: '$.id', value: needle } as any, limit: 6 })
          found = exact.items.map((hit) => hit.entry)
        }
        if (!active || ticket !== request.current) return
        setEntries(found); setLoading(false); setError(''); setTotal(page.total)
      }).catch((caught: unknown) => {
        if (!active || ticket !== request.current) return
        setEntries([]); setLoading(false); setError(caught instanceof Error ? caught.message : 'Search failed'); setTotal(0)
      })
    }, 250)
    return () => { active = false; request.current++; window.clearTimeout(timer) }
  }, [server.url, server.apiKey, scope?.project, scope?.env, query, collections])

  const setSearchQuery = (next: string) => {
    request.current++
    setEntries([])
    setError('')
    setTotal(0)
    setLoading(!!next.trim())
    setQuery(next)
  }

  return { query, entries, loading, error, total, setQuery: setSearchQuery }
}
