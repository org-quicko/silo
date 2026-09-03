import { api } from '../api/silo-api'
import type { SessionInfo } from '../api/types/session-info'
import { StoreKeys } from './store-keys'
import { useResource } from './use-resource'

/** A running process keeps the version it started on, so the badge asks once
 *  every few minutes rather than on every mount. */
const VERSION_STALE_MS = 5 * 60 * 1000

export interface SessionResource {
  /** True once the key has been checked at least once, from cache or fresh. */
  loaded: boolean
  /** The server answered 401: this key is gone, and the app owes the gate. */
  rejected: boolean
  sessionInfo: SessionInfo | null
  claims: string[]
  version: string
  loading: boolean
  error: string | null
}

/**
 * Who the connected key is, and what the instance is running.
 *
 * The two are separate cache keys because they answer on different terms — the
 * session is per key and checked on every mount, the version is per process and
 * unauthenticated — and a version that will not load must not look like a
 * session that will not verify.
 */
export function useSession(serverId: string, url: string, apiKey: string): SessionResource {
  const verified = useResource(StoreKeys.session(serverId), () => api.session.verify(url, apiKey))
  const health = useResource(StoreKeys.health(serverId), () => api.session.health(url), {
    staleAfter: VERSION_STALE_MS,
  })

  const answer = verified.value
  return {
    loaded: answer !== null,
    rejected: answer !== null && !answer.ok,
    sessionInfo: answer?.session ?? null,
    claims: answer?.session?.claims ?? [],
    version: health.value?.version ?? '',
    loading: verified.loading,
    error: verified.error,
  }
}
