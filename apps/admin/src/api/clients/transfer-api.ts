import type { CopyFromServerOptions } from '../types/copy-options'
import type { CopyScopeOptions } from '../types/copy-scope-options'
import type { ImportResult } from '../types/import-result'
import type { MediaMode } from '../types/media-mode'
import type { ScopeRef } from '../types/scope-ref'
import { HttpTransport } from '../transport/http-transport'
import { ProgressReader, type TransferProgress } from '../transport/progress-reader'
import { QueryParams } from '../transport/query-params'
import { ScopePaths } from './scope-paths'

/** What an archive operation covers, and what it does about media. */
export interface ArchiveScope {
  /** `project[/env[/collection]]` rules. Empty is the whole instance. */
  include: string[]
  media: MediaMode
}

/** Export, import, and the two copy routes. */
export class TransferApi {
  private readonly transport: HttpTransport

  constructor(transport: HttpTransport) {
    this.transport = transport
  }

  /** A tarball, so this is the one call that wants the raw response. */
  async exportArchive(
    url: string,
    key: string,
    options: ArchiveScope & { withKeys: boolean },
  ): Promise<Blob> {
    const response = await this.transport.fetchRaw(url, `/api/export${TransferApi.scope(options)}`, {
      headers: HttpTransport.authHeaders(key),
    })
    if (!response.ok) throw await HttpTransport.parseError(response)
    return response.blob()
  }

  /**
   * Uploads an archive and loads it.
   *
   * With `onProgress` the request asks for the line-delimited progress stream:
   * an import says nothing while it extracts and writes, which on a connection
   * that closes when it goes quiet is how a succeeding import looks like a
   * failing one (§7.8).
   */
  async importArchive(
    url: string,
    key: string,
    file: File,
    options: ArchiveScope & {
      mode: string
      dryRun: boolean
      prefer?: string
      onProgress?: (progress: TransferProgress) => void
    },
  ): Promise<ImportResult> {
    const params = TransferApi.params(options)
      .set('mode', options.mode)
      .set('dry_run', options.dryRun)
      .set('prefer', options.prefer)

    // The file is the body, not a form part. A `FormData` upload has to be
    // parsed as a form on the server before the archive inside it can be read,
    // which put the whole thing in memory there; a `File` body is streamed by
    // the browser and by the route. `/api/import` still accepts multipart.
    const init: RequestInit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/gzip' },
      body: file,
    }
    if (!options.onProgress) {
      return this.transport.request<ImportResult>(url, key, `/api/import${params}`, init)
    }
    return this.streamed(url, key, `/api/import${params}`, init, options.onProgress)
  }

  copyFromServer(
    url: string,
    key: string,
    options: CopyFromServerOptions,
  ): Promise<ImportResult> {
    const init: RequestInit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source_url: options.sourceUrl,
        source_api_key: options.sourceApiKey,
        mode: options.mode,
        with_keys: options.withKeys,
        dry_run: options.dryRun,
        prefer: options.prefer || undefined,
        include: options.include.length > 0 ? options.include : undefined,
        media: options.media,
      }),
    }
    if (!options.onProgress) {
      return this.transport.request<ImportResult>(url, key, '/api/copy', init)
    }
    return this.streamed(url, key, '/api/copy', init, options.onProgress)
  }

  /**
   * Copies one environment's schemas and entries onto another of the same
   * instance. Destination-driven like `/api/copy`: the path names the
   * destination, the body names the source.
   */
  copyScope(
    url: string,
    key: string,
    to: ScopeRef,
    options: CopyScopeOptions,
  ): Promise<ImportResult> {
    return this.transport.request<ImportResult>(url, key, `${ScopePaths.scope(to)}/copy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: { project: options.from.project, env: options.from.env },
        mode: options.mode,
        dry_run: options.dryRun,
        prefer: options.prefer || undefined,
        selection: options.selection?.map((item) => ({
          collection: item.collection,
          entry_ids: item.entryIds,
        })),
        detail_offset: options.detailOffset,
        detail_limit: options.detailLimit,
      }),
    })
  }

  /** The same request, answered as a progress stream rather than one body. */
  private async streamed(
    url: string,
    key: string,
    path: string,
    init: RequestInit,
    onProgress: (progress: TransferProgress) => void,
  ): Promise<ImportResult> {
    const response = await this.transport.fetchRaw(url, path, {
      ...init,
      headers: HttpTransport.authHeaders(key, {
        ...(init.headers as Record<string, string>),
        Accept: ProgressReader.ContentType,
      }),
    })
    // A refusal that happens before the work begins is still an ordinary
    // response, so it is read as one.
    if (!response.ok) throw await this.transport.fail(response)
    return ProgressReader.read(response, onProgress)
  }

  private static params(options: ArchiveScope): QueryParams {
    const params = new QueryParams().set('media', options.media)
    for (const rule of options.include) params.append('include', rule)
    return params
  }

  private static scope(options: ArchiveScope & { withKeys: boolean }): QueryParams {
    return TransferApi.params(options).set('with_keys', options.withKeys)
  }
}
