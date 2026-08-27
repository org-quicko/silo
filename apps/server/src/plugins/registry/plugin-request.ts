/**
 * Everything a package is asking an operator for (D34, split by D36).
 *
 * One object rather than three parallel lists, because the three are only ever
 * meaningful together: a claim, whether the plugin is broken without it, and the
 * author's stated reason for wanting it. A surface handed only the first two has
 * to render a claim string and hope the operator recognises it.
 */
export interface PluginRequest {
  /** Every claim asked for — declared and derived — normalized. */
  claims: string[];

  /**
   * The subset the plugin does not work without.
   *
   * The declared `permissions.required`, plus everything **derived**: a hook claim
   * for each declared hook, and `http:route` when routes are declared. Those are
   * required by construction rather than by the author's say-so — `assertDeliverable`
   * and `assertServable` already refuse a start where either is missing, because
   * the plugin would load, look healthy, and never fire.
   */
  required: string[];

  /** Claim to the author's reason, including a derived sentence for the derived
   *  claims, so a grant screen never has a row with nothing to say about it. */
  reasons: Record<string, string>;
}
