import { Claims } from '@silo/shared/claims'
import type { ScopeRef } from '../../api/types/scope-ref'
import type { SessionInfo } from '../../api/types/session-info'
import type { SessionBadge } from './session-badge'

/**
 * Builds the top bar's session pill from the verified session and the scope
 * currently on screen. Pass `scope: null` on surfaces that have not resolved
 * one (settings on a server holding no project) — the level is then read
 * instance-wide and the tooltip says so.
 */
export function buildSessionBadge(
  session: Pick<SessionInfo, 'label' | 'prefix' | 'claims'> | null,
  scope: ScopeRef | null,
): SessionBadge {
  const claims = session?.claims || []
  const detail = [
    session?.label || Claims.label(claims),
    session?.prefix || null, // already carries its own ellipsis (KeyFormat.displayPrefix)
    scope ? `${scope.project}/${scope.env}` : 'all scopes',
  ]
    .filter(Boolean)
    .join(' · ')
  return { level: Claims.accessLevel(claims, scope?.project, scope?.env), detail }
}
