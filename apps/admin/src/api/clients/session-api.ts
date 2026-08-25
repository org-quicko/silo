import { HttpTransport } from '../transport/http-transport'
import type { SessionInfo } from '../types/session-info'

/** Reachability and who the current key is. */
export class SessionApi {
  private readonly transport: HttpTransport

  constructor(transport: HttpTransport) {
    this.transport = transport
  }

  /** Unauthenticated: the one call that answers before a key exists. */
  async health(url: string): Promise<{ status: string; version: string }> {
    const response = await this.transport.fetchRaw(url, '/api/health')
    if (!response.ok) throw await HttpTransport.parseError(response)
    return response.json()
  }

  /** A 401 is an answer here, not an error — this is how a key is checked. */
  async verify(url: string, key: string): Promise<{ ok: boolean; session?: SessionInfo }> {
    const response = await this.transport.fetchRaw(url, '/api/session', {
      headers: HttpTransport.authHeaders(key),
    })
    if (response.status === 401) return { ok: false }
    if (!response.ok) throw await HttpTransport.parseError(response)
    return { ok: true, session: await response.json() }
  }

  get(url: string, key: string): Promise<SessionInfo> {
    return this.transport.request<SessionInfo>(url, key, '/api/session')
  }
}
