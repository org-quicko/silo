import type { ScopeRef } from '../types/scope-ref'
import type { Variable } from '../types/variable'
import type { HttpTransport } from '../transport/http-transport'
import { ScopePaths } from './scope-paths'

/**
 * Variables: declared once per project, valued per environment (D57).
 *
 * The split of paths mirrors the split of reach, and is worth noticing at the
 * call site: `declare`, `rename` and `undeclare` address the **project** and
 * change what every environment sees, while `setValue` and `clearValue`
 * address one environment and change only it. The Variables page draws both
 * from one screen, so the client is where the difference stays legible.
 */
export class VariablesApi {
  private readonly transport: HttpTransport

  constructor(transport: HttpTransport) {
    this.transport = transport
  }

  /** Every declaration in the project, with this environment's value. */
  list(url: string, key: string, scope: ScopeRef): Promise<Variable[]> {
    return this.transport
      .request<{ items: Variable[] }>(url, key, VariablesApi.envPath(scope))
      .then((response) => response.items)
  }

  /**
   * Declares a name for the whole project, optionally valuing it here.
   *
   * `value` is sent only when there is one, because an omitted value and an
   * empty one are different states and `undefined` is how the API is told
   * "leave this environment unset".
   */
  declare(
    url: string,
    key: string,
    scope: ScopeRef,
    input: { name: string; description?: string; value?: string },
  ): Promise<Variable> {
    return this.transport.request<Variable>(
      url,
      key,
      `${VariablesApi.projectPath(scope)}?env=${encodeURIComponent(scope.env)}`,
      VariablesApi.body('POST', {
        name: input.name,
        description: input.description ?? '',
        ...(input.value === undefined ? {} : { value: input.value }),
      }),
    )
  }

  /** Renames a declaration, or rewrites its description. Project-wide. */
  updateDeclaration(
    url: string,
    key: string,
    scope: ScopeRef,
    name: string,
    changes: { name?: string; description?: string },
  ): Promise<Variable> {
    return this.transport.request<Variable>(
      url,
      key,
      `${VariablesApi.projectPath(scope)}/${encodeURIComponent(name)}?env=${encodeURIComponent(scope.env)}`,
      VariablesApi.body('PATCH', changes),
    )
  }

  /** Forgets the name, and every environment's value with it. Project-wide. */
  undeclare(url: string, key: string, scope: ScopeRef, name: string): Promise<void> {
    return this.transport.request<void>(
      url,
      key,
      `${VariablesApi.projectPath(scope)}/${encodeURIComponent(name)}?env=${encodeURIComponent(scope.env)}`,
      { method: 'DELETE' },
    )
  }

  /** Sets this environment's value. No other environment is touched. */
  setValue(
    url: string,
    key: string,
    scope: ScopeRef,
    name: string,
    value: string,
  ): Promise<Variable> {
    return this.transport.request<Variable>(
      url,
      key,
      `${VariablesApi.envPath(scope)}/${encodeURIComponent(name)}`,
      VariablesApi.body('PUT', { value }),
    )
  }

  /** Clears this environment's value, leaving the name declared. */
  clearValue(url: string, key: string, scope: ScopeRef, name: string): Promise<Variable> {
    return this.transport.request<Variable>(
      url,
      key,
      `${VariablesApi.envPath(scope)}/${encodeURIComponent(name)}`,
      { method: 'DELETE' },
    )
  }

  private static projectPath(scope: ScopeRef): string {
    return `${ScopePaths.project(scope.project)}/variables`
  }

  private static envPath(scope: ScopeRef): string {
    return `${ScopePaths.scope(scope)}/variables`
  }

  private static body(method: string, payload: unknown): RequestInit {
    return {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }
  }
}
