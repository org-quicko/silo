import { useCallback } from 'react'
import type { Filter } from '@silo/shared/filter'
import type { ScopeRef } from '../../api/types/scope-ref'
import type { SearchSnippet } from '../../api/types/search-snippet'
import type { Entry } from '../../api/types/entry'
import { store } from '../../store/store'
import { StoreKeys } from '../../store/store-keys'
import { useResource } from '../../store/use-resource'
import { EntriesPageRequest, type EntriesPageQuery } from './entries-page-request'

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

const EMPTY_SNIPPETS: Record<string, SearchSnippet[]> = {}
const NO_ENTRIES: Entry[] = []

/**
 * One page of the entries table, read from the store (§9.1).
 *
 * Every distinct query is its own cache key, which is what retired the response
 * ticketing this used to need: typing fires several requests and they can land
 * out of order, but each writes only its own key, so the one the URL is asking
 * for is the one on screen. Paging back to a page already answered is a cache
 * read, and the previous answer stays visible while a new one is in flight.
 */
export function useEntriesData({
  serverId,
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
  serverId: string
  url: string
  apiKey: string
  scope: ScopeRef
  collection: string
  offset: number
  limit: number
  /** `null` means nobody chose one (§5.5). */
  explicitSort: string | null
  desc: boolean
  q: string
  /** Already parsed by the caller (`UrlFilter`) and memoised on the URL string, so its identity is stable across renders that don't change it. */
  filter: Filter | null
  /** Set when the URL's `?filter=` could not be read at all. Refuses to load rather than showing an unfiltered list under a URL that claims to be filtered. */
  filterError: string | null
}): EntriesDataState {
  const query: EntriesPageQuery = { offset, limit, sort: explicitSort, desc, q: q.trim(), filter }
  const key = filterError ? null : StoreKeys.entryPage(serverId, scope, collection, query)

  const state = useResource(
    key,
    () => EntriesPageRequest.load(url, apiKey, scope, collection, query),
    { keepPrevious: true },
  )

  const reload = useCallback(
    () =>
      key
        ? store
            .refresh(key, () => EntriesPageRequest.load(url, apiKey, scope, collection, query))
            .then(() => undefined)
        : Promise.resolve(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, url, apiKey, collection],
  )

  // A failure empties the table rather than keeping what `keepPrevious` holds.
  // That answer was for a different query, and a list under a message saying it
  // could not be loaded is the one wrong thing this page can show — which is
  // most of the point of `filterError`, where the query was never even sent.
  const failure = filterError ?? state.error
  if (failure) {
    return {
      entries: NO_ENTRIES,
      snippets: EMPTY_SNIPPETS,
      total: 0,
      truncated: false,
      engine: null,
      error: failure,
      loading: filterError ? false : state.loading,
      reload,
    }
  }

  const page = state.value
  return {
    entries: page?.entries ?? NO_ENTRIES,
    snippets: page?.snippets ?? EMPTY_SNIPPETS,
    total: page?.total ?? 0,
    truncated: page?.truncated ?? false,
    engine: page?.engine ?? null,
    error: '',
    loading: state.loading,
    reload,
  }
}
