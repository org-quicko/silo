import type { ScopeRef } from '../../api/types/scope-ref'

export interface Server {
  id: string
  name: string
  url: string
  apiKey: string
}

export const DefaultScope: ScopeRef = { project: 'default', env: 'prod' }

export const SERVERS_STORAGE_KEY = 'silo_servers'

/** Browser-local persistence for saved server connections. */
export class ServerStorage {
  static read(): Server[] {
    try {
      const raw = localStorage.getItem(SERVERS_STORAGE_KEY)
      if (!raw) return []
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) return []
      return parsed.filter(
        (item): item is Server =>
          Boolean(item) &&
          typeof item === 'object' &&
          typeof item.id === 'string' &&
          item.id.length > 0 &&
          typeof item.name === 'string' &&
          typeof item.url === 'string' &&
          typeof item.apiKey === 'string',
      )
    } catch {
      return []
    }
  }

  static write(servers: Server[]): void {
    localStorage.setItem(SERVERS_STORAGE_KEY, JSON.stringify(servers))
  }
}
