import type { ScopeRef } from '../../api/types/scope-ref'

export interface Server {
  id: string
  name: string
  url: string
  apiKey: string
}

export const DefaultScope: ScopeRef = { project: 'default', env: 'prod' }

