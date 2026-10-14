import type { MediaMode } from './media-mode'
import type { ScopeRef } from './scope-ref'
import type { TransferPlanItem } from './transfer-plan-item'

/**
 * A transfer from another server as this server holds it (D109–D111): what was
 * asked for, the plan's totals once it is prepared, and one page of the plan
 * while the package is still held.
 */
export interface PreparedTransfer {
  id: string
  state: 'preparing' | 'prepared' | 'applying' | 'applied' | 'stale' | 'cancelled' | 'expired'
  created_at: string
  updated_at: string
  expires_at: string
  source: { url: string }
  from: ScopeRef
  to: ScopeRef
  selection: { collection: string; entry_ids?: string[] }[]
  mode: 'merge' | 'replace'
  prefer?: 'local' | 'remote'
  media: MediaMode
  /** Entry totals; media has its own. */
  review?: {
    planned_at: string
    added: number
    updated: number
    deleted: number
    skipped: number
    rejected: number
    collections: {
      collection: string
      schema: 'create' | 'update' | 'unchanged'
      added: number
      updated: number
      deleted: number
      skipped: number
      rejected: number
    }[]
    media: { added: number; unchanged: number; skipped: number; folders_added: number; unresolved: string[] }
  }
  applied_at?: string
  entries?: { offset: number; limit: number; total: number; items: TransferPlanItem[] }
  last_error?: string
}
