import { EntryMapper } from '../entry-mapper'
import type { Entry } from '../types/entry'
import type { EntryQuery } from '../types/entry-query'
import type { ScopeRef } from '../types/scope-ref'
import type { HttpTransport } from '../transport/http-transport'
import { QueryParams } from '../transport/query-params'
import { ScopePaths } from './scope-paths'

/** One page of entries. */
export interface EntryPage {
  items: Entry[]
  total: number
  limit: number
  offset: number
}

/** Entry CRUD. Every response goes through `EntryMapper`, so no view has to
 *  know the wire envelope. */
export class EntriesApi {
  private readonly transport: HttpTransport

  constructor(transport: HttpTransport) {
    this.transport = transport
  }

  list(
    url: string,
    key: string,
    scope: ScopeRef,
    collection: string,
    query: EntryQuery = {},
  ): Promise<EntryPage> {
    const params = new QueryParams()
      .set('limit', query.limit)
      .set('offset', query.offset)
      .set('sort', query.sort)
      .json('filter', query.filter)

    return this.transport
      .request<{ data: any[]; items?: any[]; total: number; limit: number; offset: number }>(
        url,
        key,
        ScopePaths.collections(scope, `/${encodeURIComponent(collection)}${params}`),
      )
      .then((response) => ({
        items: (response.data || response.items || []).map((item) =>
          EntryMapper.fromApiEntry(item, collection),
        ),
        total: response.total,
        limit: response.limit,
        offset: response.offset,
      }))
  }

  /** Deep links land on an entry form with only an id, so the entry is fetched
   *  directly rather than picked out of a list response. */
  get(url: string, key: string, scope: ScopeRef, collection: string, id: string): Promise<Entry> {
    return this.transport
      .request<any>(url, key, EntriesApi.entryPath(scope, collection, id))
      .then((response) => EntryMapper.fromApiEntry(response, collection))
  }

  create(
    url: string,
    key: string,
    scope: ScopeRef,
    collection: string,
    data: any,
  ): Promise<Entry> {
    return this.transport
      .request<any>(url, key, ScopePaths.collections(scope, `/${encodeURIComponent(collection)}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      .then((response) => EntryMapper.fromApiEntry(response, collection))
  }

  update(
    url: string,
    key: string,
    scope: ScopeRef,
    collection: string,
    id: string,
    rev: number,
    data: any,
  ): Promise<Entry> {
    return this.transport
      .request<any>(url, key, `${EntriesApi.entryPath(scope, collection, id)}?rev=${rev}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      .then((response) => EntryMapper.fromApiEntry(response, collection))
  }

  delete(
    url: string,
    key: string,
    scope: ScopeRef,
    collection: string,
    id: string,
    rev: number,
  ): Promise<void> {
    return this.transport.request<void>(
      url,
      key,
      `${EntriesApi.entryPath(scope, collection, id)}?rev=${rev}`,
      { method: 'DELETE' },
    )
  }

  private static entryPath(scope: ScopeRef, collection: string, id: string): string {
    return ScopePaths.collections(
      scope,
      `/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`,
    )
  }
}
