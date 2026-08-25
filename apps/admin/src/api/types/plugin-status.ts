/**
 * What a plugin is *doing*, as distinct from what its record says (D39).
 *
 * `enabled` and `state` are intent — what an operator decided. This is outcome,
 * and the two can disagree: a granted, enabled plugin whose worker outlived its
 * dispatch budget is torn down and never respawned, so it is `failed` while
 * every other field still reads healthy.
 */
export interface PluginStatus {
  state: 'running' | 'stopped' | 'failed'
  /** The hooks it is actually attached to. */
  hooks: string[]
  /** Why it is not running, in a sentence, or `null` when it is. */
  detail: string | null
}
