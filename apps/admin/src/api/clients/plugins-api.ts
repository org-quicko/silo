import type { PluginStatus } from '../types/plugin-status'
import type { PluginView } from '../types/plugin-view'
import type { RescanReport } from '../types/rescan-report'
import type { HttpTransport } from '../transport/http-transport'

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
