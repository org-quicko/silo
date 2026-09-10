import { EntryMapper } from '../entry-mapper'
import type { Entry } from '../types/entry'
import type { EntryQuery } from '../types/entry-query'
import type { ScopeRef } from '../types/scope-ref'
import type { HttpTransport } from '../transport/http-transport'

/** One page of entries. */
export interface EntryPage {
  items: Entry[]
  total: number
  limit: number
  offset: number
}

/**
 * Entry CRUD. Every response goes through `EntryMapper`, so no view has to know
 * the wire envelope.
 *
 * Every read here uses silo-client's `.editable` / `.edit()` so variables remain raw.
 */
export class EntriesApi {
  private readonly transport: HttpTransport

  constructor(transport: HttpTransport) {
    this.transport = transport
  }

  async list(
    url: string,
    key: string,
    scope: ScopeRef,
    collection: string,
    query: EntryQuery = {},
  ): Promise<EntryPage> {
    const handle = this.transport.silo(url, key).scope(scope.project, scope.env).collection(collection)
    const page = await handle.editable.list({
      limit: query.limit,
      offset: query.offset,
      sort: query.sort,
      where: query.filter as any,
    })
    return {
      items: page.entries.map((entry) => EntryMapper.fromApiEntry(entry.toJSON(), collection)),
      total: page.total,
      limit: page.limit,
      offset: page.offset,
    }
  }

  /** Deep links land on an entry form with only an id, so the entry is fetched
   *  directly rather than picked out of a list response. */
  async get(url: string, key: string, scope: ScopeRef, collection: string, id: string): Promise<Entry> {
    const handle = this.transport.silo(url, key).scope(scope.project, scope.env).collection(collection)
    const entry = await handle.edit(id)
    return EntryMapper.fromApiEntry(entry.toJSON(), collection)
  }

  async create(
    url: string,
    key: string,
    scope: ScopeRef,
    collection: string,
    data: any,
  ): Promise<Entry> {
    const handle = this.transport.silo(url, key).scope(scope.project, scope.env).collection(collection)
    const entry = await handle.create(data)
    return EntryMapper.fromApiEntry(entry.toJSON(), collection)
  }

  async update(
    url: string,
    key: string,
    scope: ScopeRef,
    collection: string,
    id: string,
    rev: number,
    data: any,
  ): Promise<Entry> {
    const handle = this.transport.silo(url, key).scope(scope.project, scope.env).collection(collection)
    const entry = await handle.replace(id, rev, data)
    return EntryMapper.fromApiEntry(entry.toJSON(), collection)
  }

  delete(
    url: string,
    key: string,
    scope: ScopeRef,
    collection: string,
    id: string,
    rev: number,
  ): Promise<void> {
    const handle = this.transport.silo(url, key).scope(scope.project, scope.env).collection(collection)
    return handle.delete(id, rev)
  }
}
