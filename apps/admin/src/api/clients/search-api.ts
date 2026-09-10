import { Filter } from 'silo-client'
import { EntryMapper } from '../entry-mapper'
import type { SearchPage } from '../types/search-page'
import type { SearchQuery } from '../types/search-query'
import type { SearchReach } from '../types/search-reach'
import type { HttpTransport } from '../transport/http-transport'
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

  async run(
    url: string,
    key: string,
    reach: SearchReach,
    query: SearchQuery = {},
  ): Promise<SearchPage> {
    const silo = this.transport.silo(url, key)
    const searchQuery = {
      query: query.query,
      where: query.filter ? Filter.raw(query.filter as any) : undefined,
      sort: query.sort,
      limit: query.limit,
      offset: query.offset,
    }

    const page =
      reach.kind === 'instance'
        ? await silo.search(searchQuery)
        : reach.kind === 'scope'
          ? await silo.scope(reach.scope.project, reach.scope.env).search(searchQuery)
          : await silo.scope(reach.scope.project, reach.scope.env).collection(reach.collection).search(searchQuery)

    return {
      items: page.hits.map((hit) => ({
        project: hit.project,
        env: hit.environment,
        collection: hit.collection,
        entry: EntryMapper.fromApiEntry(hit.entry.toJSON(), hit.collection),
        snippets: [...hit.snippets],
      })),
      total: page.total,
      limit: page.limit,
      offset: page.offset,
      truncated: page.truncated,
      engine: page.engine,
    }
  }
}
