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
}
