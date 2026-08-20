// Typed client for the silo REST API (§8 of IMPLEMENTATION.md).
// The key lives in localStorage and is sent as `Authorization: Bearer <key>`.
import { ApiError } from './api-error'
import type { ValidationDetail } from '@silo/shared/validation-detail'
import type { Collection } from './types/collection'
import { EntryMapper } from './entry-mapper'
import type { KeyView } from './types/key-view'
import type { CreatedKey } from './types/created-key'
import type { SessionInfo } from './types/session-info'
import type { ImportResult } from './types/import-result'
import type { CopyFromServerOptions } from './types/copy-options'
import type { CopyScopeOptions } from './types/copy-scope-options'
import type { MediaAsset } from './types/media-asset'
import type { MediaQuery } from './types/media-query'
import type { MediaUsage } from './types/media-usage'
import type { EntryQuery } from './types/entry-query'
import type { ScopeRef } from './types/scope-ref'

export class ApiClient {
  private onUnauthorized: (() => void) | null = null

  // A stored key can be revoked out from under an open session; a 401 on any
  // authenticated call routes the app back to the welcome gate.
  setUnauthorizedHandler(fn: (() => void) | null): void {
    this.onUnauthorized = fn
  }

  private authHeaders(key: string, extra?: Record<string, string>): Record<string, string> {
    return { Authorization: `Bearer ${key}`, ...(extra || {}) }
  }

  private async parseError(res: Response): Promise<ApiError> {
    let code = 'error'
    let message = res.statusText || `HTTP ${res.status}`
    let details: ValidationDetail[] | undefined
    let info: Record<string, unknown> | undefined
    try {
      const body = await res.json()
      if (body?.error) {
        code = body.error.code || code
        message = body.error.message || message
        // Validation errors carry a list; a refused media delete carries an
        // object. Split them here so neither read site has to guess.
        if (Array.isArray(body.error.details)) details = body.error.details
        else if (body.error.details) info = body.error.details
      }
    } catch {
      /* non-JSON body */
    }
    return new ApiError(res.status, code, message, details, info)
  }

  private async req<T>(url: string, key: string, path: string, init?: RequestInit): Promise<T> {
    const baseUrl = url ? (url.endsWith('/') ? url.slice(0, -1) : url) : ''
    const res = await fetch(`${baseUrl}${path}`, { ...init, headers: this.authHeaders(key, init?.headers as any) })
    if (!res.ok) {
      const err = await this.parseError(res)
      if (err.status === 401) this.onUnauthorized?.()
      throw err
    }
    if (res.status === 204) return undefined as T
    const ct = res.headers.get('content-type') || ''
    if (ct.includes('application/json')) return (await res.json()) as T
    return (await res.text()) as unknown as T
  }

  async health(url: string): Promise<{ status: string; version: string }> {
    const baseUrl = url ? (url.endsWith('/') ? url.slice(0, -1) : url) : ''
    const res = await fetch(`${baseUrl}/api/health`)
    if (!res.ok) throw await this.parseError(res)
    return res.json()
  }

  async verify(url: string, key: string): Promise<{ ok: boolean; session?: SessionInfo }> {
    const baseUrl = url ? (url.endsWith('/') ? url.slice(0, -1) : url) : ''
    const res = await fetch(`${baseUrl}/api/session`, { headers: this.authHeaders(key) })
    if (res.status === 401) return { ok: false }
    if (!res.ok) throw await this.parseError(res)
    return { ok: true, session: await res.json() }
  }

  getSession(url: string, key: string) {
    return this.req<SessionInfo>(url, key, '/api/session')
  }

  // ---- Projects (scopes) ----

  /**
   * Collection and entry routes live under a (project, env) pair.
   * Built in one place so no call site can hand-assemble a flat path.
   */
  static collectionsPath(scope: ScopeRef, suffix = ''): string {
    return (
      `/api/projects/${encodeURIComponent(scope.project)}` +
      `/environments/${encodeURIComponent(scope.env)}/collections${suffix}`
    )
  }

  // ---- Projects and Environments ----

  listProjects(url: string, key: string): Promise<string[]> {
    return this.req<{ items: string[] }>(url, key, '/api/projects').then((r) => r.items)
  }

  createProject(url: string, key: string, project: string): Promise<{ id: string }> {
    return this.req<{ id: string }>(url, key, '/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: project }),
    })
  }

  deleteProject(url: string, key: string, project: string, force = true): Promise<void> {
    return this.req<void>(url, key, `/api/projects/${encodeURIComponent(project)}?force=${force}`, {
      method: 'DELETE',
    })
  }

  listEnvironments(url: string, key: string, project: string): Promise<string[]> {
    return this.req<{ items: string[] }>(
      url,
      key,
      `/api/projects/${encodeURIComponent(project)}/environments`,
    ).then((r) => r.items)
  }

  createEnvironment(
    url: string,
    key: string,
    project: string,
    env: string,
  ): Promise<{ id: string; project: string; env: string }> {
    return this.req<{ id: string; project: string; env: string }>(
      url,
      key,
      `/api/projects/${encodeURIComponent(project)}/environments`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: env }),
      },
    )
  }

  deleteEnvironment(
    url: string,
    key: string,
    project: string,
    env: string,
    force = true,
  ): Promise<void> {
    return this.req<void>(
      url,
      key,
      `/api/projects/${encodeURIComponent(project)}/environments/${encodeURIComponent(env)}?force=${force}`,
      { method: 'DELETE' },
    )
  }

  // ---- Collections ----

  listCollections(url: string, key: string, scope: ScopeRef) {
    return this.req<{ items: Collection[] }>(url, key, ApiClient.collectionsPath(scope)).then(
      (r) => r.items,
    )
  }

  createCollection(url: string, key: string, scope: ScopeRef, name: string, schema: any) {
    return this.req<Collection>(url, key, ApiClient.collectionsPath(scope), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, schema }),
    })
  }

  putSchema(url: string, key: string, scope: ScopeRef, name: string, schema: any) {
    return this.req<Collection>(
      url,
      key,
      ApiClient.collectionsPath(scope, `/${encodeURIComponent(name)}/schema`),
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(schema),
      },
    )
  }

  deleteCollection(url: string, key: string, scope: ScopeRef, name: string, force = false) {
    return this.req<void>(
      url,
      key,
      ApiClient.collectionsPath(scope, `/${encodeURIComponent(name)}/schema?force=${force}`),
      { method: 'DELETE' },
    )
  }

  listEntries(url: string, key: string, scope: ScopeRef, collection: string, q: EntryQuery = {}) {
    const params = new URLSearchParams()
    if (q.limit != null) params.set('limit', String(q.limit))
    if (q.offset != null) params.set('offset', String(q.offset))
    if (q.sort) params.set('sort', q.sort)
    if (q.filter) params.set('filter', JSON.stringify(q.filter))
    const qs = params.toString()
    return this.req<{ data: any[]; items?: any[]; total: number; limit: number; offset: number }>(
      url,
      key,
      ApiClient.collectionsPath(scope, `/${encodeURIComponent(collection)}${qs ? '?' + qs : ''}`),
    ).then((r) => {
      const rawList = r.data || r.items || []
      return {
        items: rawList.map((item) => EntryMapper.fromApiEntry(item, collection)),
        total: r.total,
        limit: r.limit,
        offset: r.offset,
      }
    })
  }

  // Deep links land on an entry form with only an id, so the entry is fetched
  // directly rather than picked out of a list response.
  getEntry(url: string, key: string, scope: ScopeRef, collection: string, id: string) {
    return this.req<any>(
      url,
      key,
      ApiClient.collectionsPath(
        scope,
        `/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`,
      ),
    ).then((r) => EntryMapper.fromApiEntry(r, collection))
  }

  createEntry(url: string, key: string, scope: ScopeRef, collection: string, data: any) {
    return this.req<any>(
      url,
      key,
      ApiClient.collectionsPath(scope, `/${encodeURIComponent(collection)}`),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      },
    ).then((r) => EntryMapper.fromApiEntry(r, collection))
  }

  updateEntry(
    url: string,
    key: string,
    scope: ScopeRef,
    collection: string,
    id: string,
    rev: number,
    data: any,
  ) {
    return this.req<any>(
      url,
      key,
      ApiClient.collectionsPath(
        scope,
        `/${encodeURIComponent(collection)}/${encodeURIComponent(id)}?rev=${rev}`,
      ),
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      },
    ).then((r) => EntryMapper.fromApiEntry(r, collection))
  }

  deleteEntry(
    url: string,
    key: string,
    scope: ScopeRef,
    collection: string,
    id: string,
    rev: number,
  ) {
    return this.req<void>(
      url,
      key,
      ApiClient.collectionsPath(
        scope,
        `/${encodeURIComponent(collection)}/${encodeURIComponent(id)}?rev=${rev}`,
      ),
      { method: 'DELETE' },
    )
  }

  listKeys(url: string, key: string) {
    return this.req<{ items: KeyView[] }>(url, key, '/api/keys').then((r) => r.items)
  }

  createKey(url: string, key: string, label: string, claims: string[]) {
    return this.req<CreatedKey>(url, key, '/api/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label, claims }),
    })
  }

  revokeKey(url: string, key: string, id: string) {
    return this.req<void>(url, key, `/api/keys/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }

  async exportArchive(url: string, key: string, withKeys: boolean): Promise<Blob> {
    const baseUrl = url ? (url.endsWith('/') ? url.slice(0, -1) : url) : ''
    const res = await fetch(`${baseUrl}/api/export?with_keys=${withKeys}`, { headers: this.authHeaders(key) })
    if (!res.ok) throw await this.parseError(res)
    return res.blob()
  }

  async importArchive(
    url: string,
    key: string,
    file: File,
    opts: { mode: string; validate: boolean; dryRun: boolean; prefer?: string },
  ): Promise<ImportResult> {
    const params = new URLSearchParams({
      mode: opts.mode,
      validate: String(opts.validate),
      dry_run: String(opts.dryRun),
    })
    if (opts.prefer) params.set('prefer', opts.prefer)
    const form = new FormData()
    form.append('file', file)
    return this.req<ImportResult>(url, key, `/api/import?${params.toString()}`, {
      method: 'POST',
      body: form,
    })
  }

  copyFromServer(
    url: string,
    key: string,
    opts: CopyFromServerOptions,
  ): Promise<ImportResult> {
    return this.req<ImportResult>(url, key, '/api/copy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source_url: opts.sourceUrl,
        source_api_key: opts.sourceApiKey,
        mode: opts.mode,
        with_keys: opts.withKeys,
        dry_run: opts.dryRun,
        prefer: opts.prefer || undefined,
      }),
    })
  }

  /**
   * Copy one environment's schemas and entries onto another of the same
   * instance. Destination-driven like `/api/copy`: the path names the
   * destination, the body names the source.
   */
  copyScope(
    url: string,
    key: string,
    to: ScopeRef,
    opts: CopyScopeOptions,
  ): Promise<ImportResult> {
    return this.req<ImportResult>(
      url,
      key,
      `/api/projects/${encodeURIComponent(to.project)}/environments/${encodeURIComponent(to.env)}/copy`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: { project: opts.from.project, env: opts.from.env },
          mode: opts.mode,
          dry_run: opts.dryRun,
          validate: opts.validate,
          prefer: opts.prefer || undefined,
        }),
      },
    )
  }

  // ---- Media (D23) ----
  // The catalog is searched server-side through the Query AST, so the library
  // pages rather than loading every asset and filtering in the browser.

  listMedia(url: string, key: string, query: MediaQuery = {}) {
    const params = new URLSearchParams()
    if (query.q) params.set('q', query.q)
    if (query.folder !== undefined) params.set('folder', query.folder)
    if (query.recursive) params.set('recursive', 'true')
    if (query.type) params.set('type', query.type)
    if (query.tag) params.set('tag', query.tag)
    if (query.limit !== undefined) params.set('limit', String(query.limit))
    if (query.offset !== undefined) params.set('offset', String(query.offset))
    if (query.sort) params.set('sort', query.sort)
    const qs = params.toString()
    return this.req<{ items: MediaAsset[]; total: number; limit: number; offset: number }>(
      url,
      key,
      `/api/media${qs ? `?${qs}` : ''}`,
    )
  }

  uploadMedia(url: string, key: string, file: File, folder?: string) {
    const form = new FormData()
    form.append('file', file)
    if (folder) form.append('folder', folder)
    return this.req<MediaAsset>(url, key, '/api/media', { method: 'POST', body: form })
  }

  getMediaAsset(url: string, key: string, id: string) {
    return this.req<MediaAsset>(url, key, `/api/media/${encodeURIComponent(id)}`)
  }

  /** Rename, move, or retag. Touches no blob and no entry. */
  updateMediaAsset(
    url: string,
    key: string,
    id: string,
    patch: { filename?: string; folder?: string; tags?: string[] },
  ) {
    return this.req<MediaAsset>(url, key, `/api/media/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
  }

  /** Rejects with a 409 `media_in_use` while any entry still references it. */
  deleteMedia(url: string, key: string, id: string) {
    return this.req<void>(url, key, `/api/media/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }

  listMediaUsages(url: string, key: string, id: string, limit = 50, offset = 0) {
    return this.req<{ items: MediaUsage[]; total: number; visible: number }>(
      url,
      key,
      `/api/media/${encodeURIComponent(id)}/usages?limit=${limit}&offset=${offset}`,
    )
  }

  listMediaFolders(url: string, key: string) {
    return this.req<{ items: string[] }>(url, key, '/api/media/folders').then((r) => r.items)
  }

  createMediaFolder(url: string, key: string, path: string) {
    return this.req<{ path: string }>(url, key, '/api/media/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    })
  }

  deleteMediaFolder(url: string, key: string, path: string) {
    return this.req<void>(url, key, `/api/media/folders?path=${encodeURIComponent(path)}`, {
      method: 'DELETE',
    })
  }
}

export const api = new ApiClient()
