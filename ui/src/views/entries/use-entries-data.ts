import { useEffect, useRef, useState } from 'react'
import type { Filter } from '@silo/shared/filter'
import { JsonPath } from '@silo/shared/json-path'
import { api } from '../../api/api-client'
import type { Entry } from '../../api/types/entry'
import type { ScopeRef } from '../../api/types/scope-ref'
import type { SearchSnippet } from '../../api/types/search-snippet'

export interface EntriesDataState {
  entries: Entry[]
  snippets: Record<string, SearchSnippet[]>
  total: number
  truncated: boolean
  engine: 'fts5' | 'scan' | null
  error: string
  loading: boolean
  reload: () => Promise<void>
}

/**
 * One loader for both routes the entries page can be showing. Text runs the
 * collection-reach `/search` (D30), which ranks and explains itself with
 * snippets; without text the plain list route answers, because a
 * filter-only search returns the same set in a shape the table does not
 * need. Split out of `Entries.tsx` so "how results get here" stays apart
 * from "how they're drawn" — that view is already the widest thing in this
 * feature.
 *
 * Responses are ticketed rather than cancelled: typing fires several, and
 * they can land out of order — the last one *asked for* must win, not the
 * last one to arrive.
 */
export function useEntriesData({
  url,
  apiKey,
  scope,
  collection,
  offset,
  limit,
  explicitSort,
  desc,
  q,
  filter,
  filterError,
}: {
  url: string
  apiKey: string
  scope: ScopeRef
  collection: string
  offset: number
  limit: number
  /** `null` means nobody chose one (§5.5) — that's what lets a search rank by relevance and an empty query fall back to newest-first, rather than both always sending the same default. */
  explicitSort: string | null
  desc: boolean
  q: string
  /** Already parsed by the caller (`UrlFilter`) and memoised on the URL string, so its identity is stable across renders that don't change it. */
  filter: Filter | null
  /** Set when the URL's `?filter=` could not be read at all. Refuses to load rather than showing an unfiltered list under a URL that claims to be filtered. */
  filterError: string | null
}): EntriesDataState {
  const [entries, setEntries] = useState<Entry[]>([])
  const [snippets, setSnippets] = useState<Record<string, SearchSnippet[]>>({})
  const [total, setTotal] = useState(0)
  const [truncated, setTruncated] = useState(false)
  const [engine, setEngine] = useState<'fts5' | 'scan' | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const searching = q.trim() !== ''
  const seq = useRef(0)

  const load = (): Promise<void> => {
    const ticket = ++seq.current
    const fresh = () => seq.current === ticket
    setLoading(true)

    if (filterError) {
      setEntries([])
      setSnippets({})
      setTotal(0)
      // Cleared with the rest of it: an engine badge left over from the last
      // answered search would sit in the bar claiming this refusal came from
      // somewhere.
      setEngine(null)
      setTruncated(false)
      setError(filterError)
      setLoading(false)
      return Promise.resolve()
    }

    const request = searching
      ? api
          .search(
            url,
            apiKey,
            { kind: 'collection', scope, collection },
            {
              q: q.trim(),
              filter,
              // Omitted rather than defaulted: a supplied sort beats
              // relevance (§5.5), so sending one "just to be explicit" would
              // silently turn every text search into a date listing.
              sort: explicitSort ? (desc ? '-' : '') + explicitSort : undefined,
              limit,
              offset,
            },
          )
          .then((r) => {
            if (!fresh()) return
            setEntries(r.items.map((h) => h.entry))
            setSnippets(Object.fromEntries(r.items.map((h) => [h.entry.id, h.snippets])))
            setTotal(r.total)
            setTruncated(r.truncated)
            setEngine(r.engine)
          })
      : api
          .listEntries(url, apiKey, scope, collection, {
            limit,
            offset,
            sort: (desc ? '-' : '') + (explicitSort ?? JsonPath.UpdatedAt),
            filter: filter ?? undefined,
          })
          .then((r) => {
            if (!fresh()) return
            setEntries(r.items)
            setSnippets({})
            setTotal(r.total)
            setTruncated(false)
            setEngine(null)
          })

    return request
      .then(() => fresh() && setError(''))
      .catch((e: unknown) => {
        if (!fresh()) return
        setEntries([])
        setSnippets({})
        setTotal(0)
        setError(e instanceof Error ? e.message : 'Could not load entries')
      })
      .then(() => {
        if (fresh()) setLoading(false)
      })
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, apiKey, scope.project, scope.env, collection, offset, explicitSort, desc, q, filter, filterError])

  return { entries, snippets, total, truncated, engine, error, loading, reload: load }
}
