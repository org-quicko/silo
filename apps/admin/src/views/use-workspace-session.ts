import { useEffect } from 'react'
import type { CollectionSummary } from '../api/types/collection-summary'
import type { ScopeRef } from '../api/types/scope-ref'
import type { SessionInfo } from '../api/types/session-info'
import { useCollections } from '../store/use-collections'
import { useSession } from '../store/use-session'

export interface WorkspaceSession {
  /** True once the shell has what it needs to draw. Cached answers count, so a
   *  scope opened before draws at once and refreshes behind. */
  ready: boolean
  sessionInfo: SessionInfo | null
  claims: string[]
  version: string
  collections: CollectionSummary[]
  refreshCollections: () => Promise<CollectionSummary[]>
}

/**
 * The connection the workspace shell is built on: the verified key, the
 * server's version, and the collection list every view navigates.
 *
 * All three are store keys (§9.1), so this composes rather than fetches — which
 * is what lets the shell render from the cache while the same requests go out
 * behind it. Two requests, whatever the scope holds: entry counts arrive with
 * the listing (D54) rather than one `limit=1` list per collection.
 */
export function useWorkspaceSession(
  serverId: string,
  url: string,
  apiKey: string,
  scope: ScopeRef,
  onDisconnect: () => void,
): WorkspaceSession {
  const session = useSession(serverId, url, apiKey)
  const collections = useCollections(serverId, url, apiKey, scope)

  // A key can be revoked between page loads, and a shell with nothing behind it
  // is worse than the gate. A 401 is final. A request that merely *failed*
  // sends the reader back only when there is nothing cached to show instead —
  // a server that blinked should not cost them their place.
  useEffect(() => {
    if (session.rejected) {
      onDisconnect()
      return
    }
    if (session.error && !session.loaded) onDisconnect()
    else if (collections.error && !collections.loaded) onDisconnect()
  }, [
    session.rejected,
    session.error,
    session.loaded,
    collections.error,
    collections.loaded,
    onDisconnect,
  ])

  return {
    ready: session.loaded && !session.rejected && collections.loaded,
    sessionInfo: session.sessionInfo,
    claims: session.claims,
    version: session.version,
    collections: collections.collections,
    refreshCollections: collections.refresh,
  }
}
