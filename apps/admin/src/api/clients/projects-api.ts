import { HttpTransport } from '../transport/http-transport'
import { ScopePaths } from './scope-paths'

/** Projects and environments — the two containers a collection is addressed by. */
export class ProjectsApi {
  private readonly transport: HttpTransport

  constructor(transport: HttpTransport) {
    this.transport = transport
  }

  list(url: string, key: string): Promise<string[]> {
    return this.transport
      .request<{ items: string[] }>(url, key, '/api/projects')
      .then((response) => response.items)
  }

  create(url: string, key: string, project: string): Promise<{ id: string }> {
    return this.transport.request<{ id: string }>(url, key, '/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: project }),
    })
  }

  delete(url: string, key: string, project: string, force = true): Promise<void> {
    return this.transport.request<void>(
      url,
      key,
      `${ScopePaths.project(project)}?force=${force}`,
      { method: 'DELETE' },
    )
  }

  listEnvironments(url: string, key: string, project: string): Promise<string[]> {
    return this.transport
      .request<{ items: string[] }>(url, key, ScopePaths.environments(project))
      .then((response) => response.items)
  }

  createEnvironment(
    url: string,
    key: string,
    project: string,
    env: string,
  ): Promise<{ id: string; project: string; env: string }> {
    return this.transport.request(url, key, ScopePaths.environments(project), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: env }),
    })
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
}
