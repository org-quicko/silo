import type { CopyFromServerOptions } from '../types/copy-options'
import type { CopyScopeOptions } from '../types/copy-scope-options'
import type { ImportResult } from '../types/import-result'
import type { ScopeRef } from '../types/scope-ref'
import { HttpTransport } from '../transport/http-transport'
import { QueryParams } from '../transport/query-params'
import { ScopePaths } from './scope-paths'

/** Export, import, and the two copy routes. */
export class TransferApi {
  private readonly transport: HttpTransport

  constructor(transport: HttpTransport) {
    this.transport = transport
  }

  /** A tarball, so this is the one call that wants the raw response. */
  async exportArchive(url: string, key: string, withKeys: boolean): Promise<Blob> {
    const response = await this.transport.fetchRaw(url, `/api/export?with_keys=${withKeys}`, {
      headers: HttpTransport.authHeaders(key),
    })
    if (!response.ok) throw await HttpTransport.parseError(response)
    return response.blob()
  }

  importArchive(
    url: string,
    key: string,
    file: File,
    options: { mode: string; validate: boolean; dryRun: boolean; prefer?: string },
  ): Promise<ImportResult> {
    const params = new QueryParams()
      .set('mode', options.mode)
      .set('validate', options.validate)
      .set('dry_run', options.dryRun)
      .set('prefer', options.prefer)

    // The file is the body, not a form part. A `FormData` upload has to be
    // parsed as a form on the server before the archive inside it can be read,
    // which put the whole thing in memory there; a `File` body is streamed by
    // the browser and by the route. `/api/import` still accepts multipart.
    return this.transport.request<ImportResult>(url, key, `/api/import${params}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/gzip' },
      body: file,
    })
  }

  copyFromServer(
    url: string,
    key: string,
    options: CopyFromServerOptions,
  ): Promise<ImportResult> {
    return this.transport.request<ImportResult>(url, key, '/api/copy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source_url: options.sourceUrl,
        source_api_key: options.sourceApiKey,
        mode: options.mode,
        with_keys: options.withKeys,
        dry_run: options.dryRun,
        prefer: options.prefer || undefined,
      }),
    })
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
        validate: options.validate,
        prefer: options.prefer || undefined,
      }),
    })
  }
}
