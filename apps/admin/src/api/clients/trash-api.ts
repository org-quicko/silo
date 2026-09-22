import type { TrashItem, TrashKind } from '../types/trash-item'
import type { TrashRestoreResult } from '../types/trash-restore-result'
import type { HttpTransport } from '../transport/http-transport'
import { QueryParams } from '../transport/query-params'

export interface TrashPage {
  items: TrashItem[]
  total: number
  limit: number
  offset: number
}

/** How the trash list is narrowed. Everything is optional; the default is the
 *  whole trash, newest first. */
export interface TrashQuery {
  kind?: TrashKind
  project?: string
  env?: string
  collection?: string
  deleted_after?: string
  deleted_before?: string
  q?: string
  limit?: number
  offset?: number
}

/**
 * The trash (D91).
 *
 * Reading takes no claim of its own: the server filters each receipt by the
 * read claim its origin already required, so this list is per key. Restoring
 * asks for the write claims at the destination, and only purging has a claim.
 */
export class TrashApi {
  private readonly transport: HttpTransport

  constructor(transport: HttpTransport) {
    this.transport = transport
  }

  list(url: string, key: string, query: TrashQuery = {}): Promise<TrashPage> {
    const params = new QueryParams()
      .set('kind', query.kind)
      .set('project', query.project)
      .set('env', query.env)
      .set('collection', query.collection)
      .set('deleted_after', query.deleted_after)
      .set('deleted_before', query.deleted_before)
      .set('q', query.q)
      .set('limit', query.limit)
      .set('offset', query.offset)
    return this.transport.request<TrashPage>(url, key, `/api/trash${params}`)
  }

  get(url: string, key: string, id: string): Promise<TrashItem> {
    return this.transport.request<TrashItem>(url, key, `/api/trash/${encodeURIComponent(id)}`)
  }

  /** What rode along, read-only, for an expanded row. */
  items(
    url: string,
    key: string,
    id: string,
    page: { limit?: number; offset?: number } = {},
  ): Promise<{ items: unknown[]; total: number }> {
    const params = new QueryParams().set('limit', page.limit).set('offset', page.offset)
    return this.transport.request(url, key, `/api/trash/${encodeURIComponent(id)}/items${params}`)
  }

  /** `chain` restores the blocking containers first, which is what the row's
   *  "Restore both" sends. */
  restore(
    url: string,
    key: string,
    id: string,
    options: { rename?: string; chain?: boolean } = {},
  ): Promise<TrashRestoreResult> {
    return this.transport.request<TrashRestoreResult>(
      url,
      key,
      `/api/trash/${encodeURIComponent(id)}/restore`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(options),
      },
    )
  }

  purge(url: string, key: string, id: string): Promise<void> {
    return this.transport.request<void>(url, key, `/api/trash/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
  }

  /** Empties the trash. The literal confirmation word is the same insurance
   *  the media purge takes. */
  empty(url: string, key: string): Promise<{ purged: number }> {
    return this.transport.request<{ purged: number }>(url, key, '/api/trash/purge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: 'empty' }),
    })
  }
}
