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
