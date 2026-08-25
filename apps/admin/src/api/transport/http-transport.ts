import { ApiError } from '../api-error'
import type { ValidationDetail } from '@silo/shared/validation-detail'

/**
 * The one place a request to a silo server is made.
 *
 * Every resource client goes through here, so the bearer header, the error
 * shape and the 401 handling are stated once. `url` and `key` are arguments
 * rather than state because the admin UI talks to several servers and the
 * chosen one can change between two calls.
 */
export class HttpTransport {
  private unauthorizedHandler: (() => void) | null = null

  /** A stored key can be revoked out from under an open session; a 401 on any
   *  authenticated call routes the app back to the welcome gate. */
  setUnauthorizedHandler(handler: (() => void) | null): void {
    this.unauthorizedHandler = handler
  }

  /** Trailing slash removed, so a caller's `http://host/` and `http://host`
   *  build the same request path. */
  static baseUrl(url: string): string {
    if (!url) return ''
    return url.endsWith('/') ? url.slice(0, -1) : url
  }

  static authHeaders(key: string, extra?: Record<string, string>): Record<string, string> {
    return { Authorization: `Bearer ${key}`, ...(extra || {}) }
  }

  /** An authenticated request, decoded by content type. */
  async request<T>(url: string, key: string, path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${HttpTransport.baseUrl(url)}${path}`, {
      ...init,
      headers: HttpTransport.authHeaders(key, init?.headers as any),
    })
    if (!response.ok) throw await this.fail(response)

    if (response.status === 204) return undefined as T

    const contentType = response.headers.get('content-type') || ''
    if (contentType.includes('application/json')) return (await response.json()) as T
    return (await response.text()) as unknown as T
  }

  /** The raw `Response`, for the calls that want a blob or their own status
   *  handling. Errors are still parsed the same way. */
  async fetchRaw(url: string, path: string, init?: RequestInit): Promise<Response> {
    return fetch(`${HttpTransport.baseUrl(url)}${path}`, init)
  }

  /** Turns a failed response into an `ApiError`, and fires the 401 handler. */
  async fail(response: Response): Promise<ApiError> {
    const error = await HttpTransport.parseError(response)
    if (error.status === 401) this.unauthorizedHandler?.()
    return error
  }

  static async parseError(response: Response): Promise<ApiError> {
    let code = 'error'
    let message = response.statusText || `HTTP ${response.status}`
    let details: ValidationDetail[] | undefined
    let info: Record<string, unknown> | undefined

    try {
      const body = await response.json()
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
    return new ApiError(response.status, code, message, details, info)
  }
}
