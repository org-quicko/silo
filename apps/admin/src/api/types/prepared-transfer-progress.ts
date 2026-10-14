import type { PreparedTransfer } from './prepared-transfer'

/**
 * One progress line of a transfer's preparation or apply. Every line but a
 * bare heartbeat names the transfer, so the first one is enough to cancel it.
 */
export interface PreparedTransferProgress {
  /** `fetch`, `verify`, `plan` while preparing; `media`, `commit` while applying. */
  phase: string
  transfer?: Pick<PreparedTransfer, 'id' | 'state' | 'expires_at'>
}
