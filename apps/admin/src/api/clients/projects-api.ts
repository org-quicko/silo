import type { RenameResult, ScopeRecord } from '../types/scope-record'
import type { HttpTransport } from '../transport/http-transport'

/** Projects and environments — the two containers a collection is addressed by. */
export class ProjectsApi {
  private readonly transport: HttpTransport

  constructor(transport: HttpTransport) {
    this.transport = transport
  }

  list(url: string, key: string): Promise<ScopeRecord[]> {
    return this.transport.silo(url, key).projects.list()
  }

  create(url: string, key: string, project: string): Promise<ScopeRecord> {
    return this.transport.silo(url, key).projects.create(project)
  }

  /**
   * Renames a project. Addressed by its current name like every other route,
   * and bound to `expectedId` so a request delayed in flight cannot rename
   * whatever took the name meanwhile (D51).
   */
  rename(
    url: string,
    key: string,
    project: string,
    name: string,
    expectedId: string,
    dryRun = false,
  ): Promise<RenameResult> {
    return this.transport.silo(url, key).project(project).rename(name, { expectedId, dryRun })
  }

  delete(url: string, key: string, project: string, force = true): Promise<void> {
    return this.transport.silo(url, key).project(project).delete({ force })
  }

  listEnvironments(url: string, key: string, project: string): Promise<ScopeRecord[]> {
    return this.transport.silo(url, key).project(project).environments.list()
  }

  createEnvironment(
    url: string,
    key: string,
    project: string,
    env: string,
  ): Promise<ScopeRecord> {
    return this.transport.silo(url, key).project(project).environments.create(env)
  }

  renameEnvironment(
    url: string,
    key: string,
    project: string,
    env: string,
    name: string,
    expectedId: string,
    dryRun = false,
  ): Promise<RenameResult> {
    return this.transport.silo(url, key).scope(project, env).rename(name, { expectedId, dryRun })
  }

  deleteEnvironment(
    url: string,
    key: string,
    project: string,
    env: string,
    force = true,
  ): Promise<void> {
    return this.transport.silo(url, key).scope(project, env).delete({ force })
  }
}
