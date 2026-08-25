import type { ScopeRef } from './scope-ref'

/**
 * How far a search looks (D30). Modelled as a union rather than three optional
 * fields so the impossible reaches cannot be written down: a collection with
 * no scope, or a scope with only an environment. The server takes the reach
 * from the URL path for the same reason — a forgotten query parameter would
 * *widen* a search rather than narrow it.
 */
export type SearchReach =
  | { kind: 'instance' }
  | { kind: 'scope'; scope: ScopeRef }
  | { kind: 'collection'; scope: ScopeRef; collection: string }
