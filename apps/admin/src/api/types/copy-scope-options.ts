import type { ScopeRef } from './scope-ref'

/**
 * A copy between two scopes of one instance. The destination is the route, so
 * only the source appears here (D22).
 */
export interface CopyScopeOptions {
  from: ScopeRef
  mode: 'merge' | 'replace'
  dryRun: boolean
  prefer?: '' | 'local' | 'remote'
  validate?: boolean
  /** Omit for the whole source scope; entryIds narrows one collection. */
  selection?: CopyScopeSelection[]
  detailOffset?: number
  detailLimit?: number
}

export interface CopyScopeSelection {
  collection: string
  entryIds?: string[]
}
