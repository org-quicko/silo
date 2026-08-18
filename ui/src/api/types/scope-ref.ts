/**
 * The (project, env) pair every collection and entry route is scoped to
 * (D19). Ids follow the same grammar as collection names — validate with
 * `Claims.isScopeId` before putting one in a URL.
 */
export interface ScopeRef {
  project: string
  env: string
}
