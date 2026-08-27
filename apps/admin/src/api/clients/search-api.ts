import { EntryMapper } from '../entry-mapper'
import type { SearchPage } from '../types/search-page'
import type { SearchQuery } from '../types/search-query'
import type { SearchReach } from '../types/search-reach'
import type { HttpTransport } from '../transport/http-transport'
import { QueryParams } from '../transport/query-params'
import { ScopePaths } from './scope-paths'

/** Full-text search (D30) across the instance, one scope, or one collection. */
export class SearchApi {
  private readonly transport: HttpTransport

  constructor(transport: HttpTransport) {
    this.transport = transport
  }

  /** The reach is in the path, never in a parameter — see `SearchReach`. */
  static path(reach: SearchReach): string {
    if (reach.kind === 'instance') return '/api/search'

    const base = ScopePaths.scope(reach.scope)
    return reach.kind === 'scope'
      ? `${base}/search`
      : `${base}/collections/${encodeURIComponent(reach.collection)}/search`
  }

  run(
    url: string,
    key: string,
    reach: SearchReach,
    query: SearchQuery = {},
  ): Promise<SearchPage> {
    const params = new QueryParams()
      .set('q', query.q)
      .json('filter', query.filter)
      // Omitted rather than defaulted: §5.5 gives a supplied sort precedence
      // over relevance, so sending one "just to be explicit" would silently
      // turn every text search into a date listing.
      .set('sort', query.sort)
      .set('limit', query.limit)
      .set('offset', query.offset)

    return this.transport
      .request<{
        data: any[]
        total: number
        limit: number
        offset: number
        truncated: boolean
        engine: 'fts5' | 'scan'
      }>(url, key, `${SearchApi.path(reach)}${params}`)
      .then((response) => ({
        items: (response.data || []).map((hit) => ({
          project: hit.project,
          env: hit.env,
          collection: hit.collection,
          entry: EntryMapper.fromApiEntry(hit.entry, hit.collection),
          snippets: hit.snippets || [],
        })),
        total: response.total,
        limit: response.limit,
        offset: response.offset,
        truncated: response.truncated,
        engine: response.engine,
      }))
  }
}
