import type { Filter } from '@silo/shared/filter'
import { JsonPath } from '@silo/shared/json-path'
import { api } from '../../api/silo-api'
import type { Entry } from '../../api/types/entry'
import type { ScopeRef } from '../../api/types/scope-ref'
import type { SearchSnippet } from '../../api/types/search-snippet'

/** What the entries table draws, whichever of the two routes answered. */
export interface EntriesPage {
  entries: Entry[]
  snippets: Record<string, SearchSnippet[]>
  total: number
  truncated: boolean
  engine: 'fts5' | 'scan' | null
}

/** Everything that decides which answer the table is showing. Serialized whole
 *  into the cache key, so two of these are the same page or different ones. */
export interface EntriesPageQuery {
  offset: number
  limit: number
  /** `null` means nobody chose one (§5.5) — that is what lets a search rank by
   *  relevance and an empty query fall back to newest-first. */
  sort: string | null
  desc: boolean
  /** Already trimmed by the caller, so the key does not distinguish `"a"` from
   *  `"a "`. */
  q: string
  filter: Filter | null
}

/**
 * The request behind one page of a collection's entries.
 *
 * Text runs the collection-reach `/search` (D30), which ranks and explains
 * itself with snippets; without text the plain list route answers, because a
 * filter-only search returns the same set in a shape the table does not need.
 */
export class EntriesPageRequest {
  static load(
    url: string,
    apiKey: string,
    scope: ScopeRef,
    collection: string,
    query: EntriesPageQuery,
  ): Promise<EntriesPage> {
    return query.q === ''
      ? EntriesPageRequest.list(url, apiKey, scope, collection, query)
      : EntriesPageRequest.search(url, apiKey, scope, collection, query)
  }

  private static list(
    url: string,
    apiKey: string,
    scope: ScopeRef,
    collection: string,
    query: EntriesPageQuery,
  ): Promise<EntriesPage> {
    return api.entries
      .list(url, apiKey, scope, collection, {
        limit: query.limit,
        offset: query.offset,
        sort: (query.desc ? '-' : '') + (query.sort ?? JsonPath.UpdatedAt),
        filter: query.filter ?? undefined,
      })
      .then((page) => ({
        entries: page.items,
        snippets: {},
        total: page.total,
        truncated: false,
        engine: null,
      }))
  }

  private static search(
    url: string,
    apiKey: string,
    scope: ScopeRef,
    collection: string,
    query: EntriesPageQuery,
  ): Promise<EntriesPage> {
    return api.search
      .run(
        url,
        apiKey,
        { kind: 'collection', scope, collection },
        {
          query: query.q,
          filter: query.filter,
          // Omitted rather than defaulted: a supplied sort beats relevance
          // (§5.5), so sending one "just to be explicit" would silently turn
          // every text search into a date listing.
          sort: query.sort ? (query.desc ? '-' : '') + query.sort : undefined,
          limit: query.limit,
          offset: query.offset,
        },
      )
      .then((page) => ({
        entries: page.items.map((hit) => hit.entry),
        snippets: Object.fromEntries(page.items.map((hit) => [hit.entry.id, hit.snippets])),
        total: page.total,
        truncated: page.truncated,
        engine: page.engine,
      }))
  }
}
