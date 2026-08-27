import type { PluginPanelSource, PluginView } from '../types/plugin-view'
import type { PluginInstallRequest, PluginInstallResponse } from '../types/plugin-install'
import type { PluginStatus } from '../types/plugin-status'
import type { RescanReport } from '../types/rescan-report'
import { HttpTransport } from '../transport/http-transport'

/**
 * Plugin grants and lifecycle (D38, D39). Everything here acts on the
 * `_plugins` record and the running set, and takes effect immediately.
 *
 * Every call that writes the record carries `If-Match`, which on a grant is not
 * ceremony: approving means approving *what you read*, so a package whose
 * request changed between the read and the approval is refused rather than
 * approved on the strength of the older one. `restart` and `rescan` write no
 * record and take none.
 */
export class PluginsApi {
  private readonly transport: HttpTransport

  constructor(transport: HttpTransport) {
    this.transport = transport
  }

  list(url: string, key: string): Promise<PluginView[]> {
    return this.transport
      .request<{ items: PluginView[] }>(url, key, '/api/plugins')
      .then((response) => response.items)
  }

  get(url: string, key: string, name: string): Promise<PluginView> {
    return this.transport.request<PluginView>(url, key, PluginsApi.path(name))
  }

  /**
   * Relay one request from a plugin panel to that plugin's own routes (D41).
   *
   * Raw on purpose: it returns the status and the bytes rather than a decoded
   * body, because a panel is entitled to see what its own route answered — a
   * 400 with a validation list is a result the panel renders, not an exception
   * the admin should be swallowing on its way past. That also keeps the 401
   * handler out of the path, which matters: a panel route answering 401 is a
   * fact about the plugin's grant, and bouncing the operator to the welcome gate
   * over it would be the wrong conclusion drawn from the right status.
   *
   * **This method authorizes nothing.** The path has already been checked
   * against the panel's own namespace by `readPanelMessage`, which is where that
   * rule belongs — it is the security boundary, and it is pure so it can be
   * tested without a DOM. Here the only job is to attach the operator's key, and
   * that is exactly the thing a panel cannot do for itself.
   */
  async relay(
    url: string,
    key: string,
    request: {
      method: string
      path: string
      headers: Record<string, string>
      body: string | Uint8Array | null
    },
  ): Promise<{ status: number; ok: boolean; headers: Record<string, string>; bytes: Uint8Array }> {
    const response = await this.transport.fetchRaw(url, request.path, {
      method: request.method,
      // The panel's headers first, so a panel cannot displace the credential by
      // spelling the header itself — `readPanelMessage` already drops every name
      // outside its allowlist, and this is the ordering that makes that
      // belt-and-braces rather than load-bearing.
      headers: { ...request.headers, ...HttpTransport.authHeaders(key) },
      ...(request.body === null ? {} : { body: request.body as any }),
    })

    const headers: Record<string, string> = {}
    response.headers.forEach((value, name) => {
      headers[name] = value
    })
    return {
      status: response.status,
      ok: response.ok,
      headers,
      bytes: new Uint8Array(await response.arrayBuffer()),
    }
  }

  /**
   * The HTML of a plugin's declared admin panel (D41).
   *
   * Its own call and not a field on `PluginView`, because a panel is kilobytes
   * of markup and the view is fetched for every plugin in the list. Re-fetched
   * rather than cached: an operator opening the screen is the only thing that
   * asks for it, and a stale panel after an upgrade has nothing to invalidate it.
   */
  panel(url: string, key: string, name: string): Promise<PluginPanelSource> {
    return this.transport.request<PluginPanelSource>(url, key, `${PluginsApi.path(name)}/ui`)
  }

  /**
   * Approve, or narrow an existing approval, to exactly `claims`.
   *
   * The body is the complete granted set rather than a delta, so sending it
   * twice grants the same thing and narrowing needs no revoke first.
   */
  grant(url: string, key: string, name: string, rev: number, claims: string[]): Promise<PluginView> {
    return this.write(url, key, `${PluginsApi.path(name)}/grant`, rev, 'PUT', { claims })
  }

  /** Withdraw the stored grant. `silo.toml` claims, if the operator wrote any,
   *  survive it — the server says so in the record that comes back. */
  revoke(url: string, key: string, name: string, rev: number): Promise<PluginView> {
    return this.write(url, key, `${PluginsApi.path(name)}/grant`, rev, 'DELETE')
  }

  setEnabled(
    url: string,
    key: string,
    name: string,
    rev: number,
    enabled: boolean,
  ): Promise<PluginView> {
    const verb = enabled ? 'enable' : 'disable'
    return this.write(url, key, `${PluginsApi.path(name)}/${verb}`, rev, 'POST')
  }

  /** An [RFC 7396](https://www.rfc-editor.org/rfc/rfc7396) merge patch: one
   *  setting changes without restating the block, and `null` removes one. */
  configure(
    url: string,
    key: string,
    name: string,
    rev: number,
    patch: Record<string, unknown>,
  ): Promise<PluginView> {
    return this.write(url, key, `${PluginsApi.path(name)}/config`, rev, 'PATCH', patch)
  }

  /** Drop the stored override and go back to `silo.toml`'s block. */
  clearConfig(url: string, key: string, name: string, rev: number): Promise<PluginView> {
    return this.write(url, key, `${PluginsApi.path(name)}/config`, rev, 'DELETE')
  }

  /** Bring a dead worker back. Never automatic: a plugin that missed its
   *  budget is usually still spinning, so a respawn walks into the same wall. */
  restart(url: string, key: string, name: string): Promise<PluginStatus> {
    return this.transport.request<PluginStatus>(url, key, `${PluginsApi.path(name)}/restart`, {
      method: 'POST',
    })
  }

  /** Re-read `silo.toml` and apply it. Also how a grant made with the offline
   *  CLI reaches a server that is already running. */
  rescan(url: string, key: string): Promise<RescanReport> {
    return this.transport.request<RescanReport>(url, key, '/api/plugins/rescan', { method: 'POST' })
  }

  /**
   * Acquire a package and adopt it, without a restart (D42).
   *
   * The response is a plugin view with `warnings`, except for a package that
   * contributes only providers — which has no record to view, so `state` and
   * `runtime` come back `null` and the warnings carry the reason.
   */
  install(
    url: string,
    key: string,
    payload: PluginInstallRequest,
  ): Promise<PluginInstallResponse> {
    return this.transport.request<PluginInstallResponse>(url, key, '/api/plugins/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  }

  /**
   * The same install, with the package uploaded instead of named.
   *
   * `fetchRaw` because `request` would set a JSON content type over the one
   * `FormData` has to choose for itself — the multipart boundary is in it. The
   * failure path still goes through `transport.fail`, so a refused upload
   * arrives as the same `ApiError` every other call throws, and a 401 still
   * routes the session back to the gate.
   */
  async installArchive(
    url: string,
    key: string,
    file: File,
    options: Omit<PluginInstallRequest, 'spec'> = {},
  ): Promise<PluginInstallResponse> {
    const form = new FormData()
    form.append('file', file)
    for (const [field, value] of Object.entries(options)) {
      if (value === undefined || value === '') continue
      form.append(field, Array.isArray(value) ? value.join(',') : String(value))
    }

    const response = await this.transport.fetchRaw(url, '/api/plugins/install', {
      method: 'POST',
      headers: HttpTransport.authHeaders(key),
      body: form,
    })
    if (!response.ok) throw await this.transport.fail(response)
    return (await response.json()) as PluginInstallResponse
  }

  private write(
    url: string,
    key: string,
    path: string,
    rev: number,
    method: 'PUT' | 'POST' | 'PATCH' | 'DELETE',
    body?: Record<string, unknown>,
  ): Promise<PluginView> {
    return this.transport.request<PluginView>(url, key, path, {
      method,
      headers: {
        'If-Match': `"${rev}"`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  }

  private static path(name: string): string {
    return `/api/plugins/${encodeURIComponent(name)}`
  }
}
