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
 * Every read here passes `{ variables: 'raw' }` so the `{{NAME}}` templates
 * reach the form as typed: a form seeded with a resolved value saves that value
 * back, replacing the reference with a snapshot of what it meant (D57).
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
    const page = await handle.list(
      {
        limit: query.limit,
        offset: query.offset,
        sort: query.sort,
        where: query.filter as any,
      },
      { variables: 'raw' },
    )
    return {
      items: page.entries.map((entry) => EntryMapper.fromApiEntry(entry, collection)),
      total: page.total,
      limit: page.limit,
      offset: page.offset,
    }
  }

  /** Deep links land on an entry form with only an id, so the entry is fetched
   *  directly rather than picked out of a list response. */
  async get(url: string, key: string, scope: ScopeRef, collection: string, id: string): Promise<Entry> {
    const handle = this.transport.silo(url, key).scope(scope.project, scope.env).collection(collection)
    const entry = await handle.get(id, { variables: 'raw' })
    return EntryMapper.fromApiEntry(entry, collection)
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
    return EntryMapper.fromApiEntry(entry, collection)
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
    return EntryMapper.fromApiEntry(entry, collection)
  }

  /** Answers the trash receipt's id, or null when nothing was kept (D91) —
   *  which is what the undo toast hangs off. */
  delete(
    url: string,
    key: string,
    scope: ScopeRef,
    collection: string,
    id: string,
    rev: number,
  ): Promise<string | null> {
    const handle = this.transport.silo(url, key).scope(scope.project, scope.env).collection(collection)
    return handle.delete(id, rev)
  }
}
