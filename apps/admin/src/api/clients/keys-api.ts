import type { CreatedKey } from '../types/created-key'
import type { KeyView } from '../types/key-view'
import type { HttpTransport } from '../transport/http-transport'

/** API keys. The secret exists only in the response that mints it. */
export class KeysApi {
  private readonly transport: HttpTransport

  constructor(transport: HttpTransport) {
    this.transport = transport
  }

  list(url: string, key: string): Promise<KeyView[]> {
    return this.transport
      .request<{ items: KeyView[] }>(url, key, '/api/keys')
      .then((response) => response.items)
  }

  create(url: string, key: string, label: string, claims: string[]): Promise<CreatedKey> {
    return this.transport.request<CreatedKey>(url, key, '/api/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label, claims }),
    })
  }

  revoke(url: string, key: string, id: string): Promise<void> {
    return this.transport.request<void>(url, key, `/api/keys/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
  }
}
