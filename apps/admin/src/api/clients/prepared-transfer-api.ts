import { EntryMapper } from '../entry-mapper'
import type { Entry } from '../types/entry'
import type { PrepareTransferOptions } from '../types/prepare-transfer-options'
import type { PreparedTransfer } from '../types/prepared-transfer'
import type { PreparedTransferProgress } from '../types/prepared-transfer-progress'
import type { ScopeRef } from '../types/scope-ref'
import type { HttpTransport } from '../transport/http-transport'
import { QueryParams } from '../transport/query-params'
import { ScopePaths } from './scope-paths'

/**
 * A transfer from another server into one environment of this one (D109–D111):
 * prepare it, page through its plan, read a packaged entry, apply it, cancel
 * it. Every call goes to the destination; only `prepare` carries the source's
 * key, in its body.
 */
export class PreparedTransferApi {
  private readonly transport: HttpTransport

  constructor(transport: HttpTransport) {
    this.transport = transport
  }

  /** Pulls, checks and plans the source's package. The pull says nothing for
   *  as long as the media takes, so this always asks for the progress stream. */
  prepare(
    url: string,
    key: string,
    to: ScopeRef,
    options: PrepareTransferOptions,
    onProgress: (progress: PreparedTransferProgress) => void,
  ): Promise<PreparedTransfer> {
    const body = {
      source: { url: options.sourceUrl, api_key: options.sourceApiKey },
      from: { project: options.from.project, env: options.from.env },
      selection: options.selection.map((item) => ({ collection: item.collection, entry_ids: item.entryIds })),
      mode: options.mode,
      prefer: options.prefer || undefined,
      media: options.media,
    }
    return this.transport.streamed<PreparedTransfer, PreparedTransferProgress>(
      url,
      key,
      PreparedTransferApi.path(to),
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      onProgress,
    )
  }

  /** The transfer, with the page of its plan that starts at `offset`. */
  read(url: string, key: string, to: ScopeRef, id: string, offset = 0): Promise<PreparedTransfer> {
    const params = new QueryParams().set('detail_offset', offset)
    return this.transport.request<PreparedTransfer>(url, key, `${PreparedTransferApi.path(to, id)}${params}`)
  }

  /** The packaged copy of one entry: what Apply would write. */
  async entry(url: string, key: string, to: ScopeRef, id: string, collection: string, entryId: string): Promise<Entry> {
    const path = `${PreparedTransferApi.path(to, id)}/entries/${encodeURIComponent(collection)}/${encodeURIComponent(entryId)}`
    return EntryMapper.fromApiEntry(await this.transport.request(url, key, path), collection)
  }

  /** Writes the plan as one commit, or nothing; streamed for the media files. */
  apply(
    url: string,
    key: string,
    to: ScopeRef,
    id: string,
    onProgress: (progress: PreparedTransferProgress) => void,
  ): Promise<PreparedTransfer> {
    return this.transport.streamed<PreparedTransfer, PreparedTransferProgress>(
      url,
      key,
      `${PreparedTransferApi.path(to, id)}/apply`,
      { method: 'POST' },
      onProgress,
    )
  }

  /** `keepalive` lets the request outlive a closing tab. */
  cancel(url: string, key: string, to: ScopeRef, id: string, keepalive = false): Promise<PreparedTransfer> {
    return this.transport.request<PreparedTransfer>(url, key, PreparedTransferApi.path(to, id), { method: 'DELETE', keepalive })
  }

  private static path(to: ScopeRef, id?: string): string {
    const base = `${ScopePaths.scope(to)}/transfers`
    return id ? `${base}/${encodeURIComponent(id)}` : base
  }
}
