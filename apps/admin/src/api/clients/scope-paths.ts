import type { ScopeRef } from '../types/scope-ref'

/** The path prefixes every scoped route hangs off, built in one place so no
 *  call site can hand-assemble a flat path. */
export class ScopePaths {
  static project(project: string): string {
    return `/api/projects/${encodeURIComponent(project)}`
  }

  static environments(project: string): string {
    return `${ScopePaths.project(project)}/environments`
  }

  static environment(project: string, env: string): string {
    return `${ScopePaths.environments(project)}/${encodeURIComponent(env)}`
  }

  static scope(scope: ScopeRef): string {
    return ScopePaths.environment(scope.project, scope.env)
  }

  /** Collection and entry routes live under a (project, env) pair. */
  static collections(scope: ScopeRef, suffix = ''): string {
    return `${ScopePaths.scope(scope)}/collections${suffix}`
  }
}
