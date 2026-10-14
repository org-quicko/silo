import type { CopyScopeSelection } from './copy-scope-options'
import type { ScopeRef } from './scope-ref'

/**
 * What to pull from another server into this environment (D109). The source
 * key rides this one request and is never stored, here or on the server.
 */
export interface PrepareTransferOptions {
  sourceUrl: string
  sourceApiKey: string
  from: ScopeRef
  /** Never empty: a transfer names what it carries. */
  selection: CopyScopeSelection[]
  mode: 'merge' | 'replace'
  prefer?: '' | 'local' | 'remote'
  media: 'referenced' | 'none'
}
