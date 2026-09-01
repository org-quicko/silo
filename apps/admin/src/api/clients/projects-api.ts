import type { RenameResult, ScopeRecord } from '../types/scope-record'
import { HttpTransport } from '../transport/http-transport'
import { ScopePaths } from './scope-paths'

/** Projects and environments — the two containers a collection is addressed by. */
export class ProjectsApi {
  private readonly transport: HttpTransport

  constructor(transport: HttpTransport) {
    this.transport = transport
  }

  list(url: string, key: string): Promise<ScopeRecord[]> {
    return this.transport
      .request<{ items: ScopeRecord[] }>(url, key, '/api/projects')
      .then((response) => response.items)
  }

  create(url: string, key: string, project: string): Promise<ScopeRecord> {
    return this.transport.request<ScopeRecord>(url, key, '/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: project }),
    })
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
    return this.transport.request<RenameResult>(
      url,
      key,
      `${ScopePaths.project(project)}${ProjectsApi.renameQuery(expectedId, dryRun)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      },
    )
  }

  delete(url: string, key: string, project: string, force = true): Promise<void> {
    return this.transport.request<void>(
      url,
      key,
      `${ScopePaths.project(project)}?force=${force}`,
      { method: 'DELETE' },
    )
  }

  listEnvironments(url: string, key: string, project: string): Promise<ScopeRecord[]> {
    return this.transport
      .request<{ items: ScopeRecord[] }>(url, key, ScopePaths.environments(project))
      .then((response) => response.items)
  }

  createEnvironment(
    url: string,
    key: string,
    project: string,
    env: string,
  ): Promise<ScopeRecord> {
    return this.transport.request(url, key, ScopePaths.environments(project), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: env }),
    })
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
    return this.transport.request<RenameResult>(
      url,
      key,
      `${ScopePaths.environment(project, env)}${ProjectsApi.renameQuery(expectedId, dryRun)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      },
    )
  }

  deleteEnvironment(
    url: string,
    key: string,
    project: string,
    env: string,
    force = true,
  ): Promise<void> {
    return this.transport.request<void>(
      url,
      key,
      `${ScopePaths.environment(project, env)}?force=${force}`,
      { method: 'DELETE' },
    )
  }

  private static renameQuery(expectedId: string, dryRun: boolean): string {
    const query = new URLSearchParams({ expected_id: expectedId })
    if (dryRun) query.set('dry_run', 'true')
    return `?${query.toString()}`
  }
}
