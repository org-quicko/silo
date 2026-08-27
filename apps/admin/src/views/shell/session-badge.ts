import type { AccessLevel } from '@silo/shared/access-level'

/**
 * What the top bar's session pill says. The visible half is the *derived*
 * access level for the scope on screen, not the key's label: a label is chosen
 * by whoever minted the key and tends to echo the server name already shown in
 * the sidebar, whereas the level answers a question the rest of the chrome
 * cannot — why an action is or is not available here.
 *
 * The key's own identity (label, prefix) moves into `detail`, shown on hover,
 * with the full record at Settings → Connection.
 */
export interface SessionBadge {
  level: AccessLevel
  detail: string
}

/**
 * Phrased from the reader's side ("what can I do here"), not the claim
 * grammar's — the claims themselves are on the Keys page. Shared by the top
 * bar's session pill and the sidebar's account row, so the two never say it
 * two different ways.
 */
export const ACCESS_TEXT: Record<AccessLevel, string> = {
  root: 'Full access',
  write: 'Read & write',
  read: 'Read-only',
  none: 'No access',
}
