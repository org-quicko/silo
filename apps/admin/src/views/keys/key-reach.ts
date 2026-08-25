/**
 * How wide a key's collection claims are, expressed as the three segments of
 * `collections:<project>/<env>/<name>` rather than as one "scope level".
 *
 * The claim grammar wildcards each segment independently (D19), so project and
 * env are orthogonal choices, not rungs of a ladder: pinning the environment
 * while wildcarding the project — every project's `prod` — is as valid as the
 * reverse, and is what a monitoring or promotion key wants. The three-option
 * "Environment / Project / All Projects" control this replaces could not
 * express it.
 */
export type KeyReach =
  /** One project, one environment. */
  | 'env'
  /** One project, every environment. */
  | 'project'
  /** Every project, one environment. */
  | 'env-all-projects'
  /** Every project, every environment. */
  | 'instance'
