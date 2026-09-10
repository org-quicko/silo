import type { ScopeRef } from '../types/scope-ref'
import type { Variable } from '../types/variable'
import type { HttpTransport } from '../transport/http-transport'

/**
 * Variables: declared once per project, valued per environment (D57).
 */
export class VariablesApi {
  private readonly transport: HttpTransport

  constructor(transport: HttpTransport) {
    this.transport = transport
  }

  /** Every declaration in the project, with this environment's value. */
  list(url: string, key: string, scope: ScopeRef): Promise<Variable[]> {
    return this.transport.silo(url, key).scope(scope.project, scope.env).variables.list()
  }

  /**
   * Declares a name for the whole project, optionally valuing it here.
   */
  declare(
    url: string,
    key: string,
    scope: ScopeRef,
    input: { name: string; description?: string; value?: string },
  ): Promise<Variable> {
    return this.transport.silo(url, key).project(scope.project).variables.declare(input.name, {
      description: input.description,
      environment: scope.env,
      value: input.value,
    })
  }

  /** Renames a declaration, or rewrites its description. Project-wide. */
  async updateDeclaration(
    url: string,
    key: string,
    scope: ScopeRef,
    name: string,
    changes: { name?: string; description?: string },
  ): Promise<Variable> {
    const handle = this.transport.silo(url, key).project(scope.project).variables
    if (changes.name && changes.name !== name) {
      const renamed = await handle.rename(name, changes.name, { environment: scope.env })
      if (changes.description !== undefined) {
        return handle.describe(changes.name, changes.description, { environment: scope.env })
      }
      return renamed
    }
    if (changes.description !== undefined) {
      return handle.describe(name, changes.description, { environment: scope.env })
    }
    const list = await this.list(url, key, scope)
    return list.find((v) => v.name === name)!
  }

  /** Forgets the name, and every environment's value with it. Project-wide. */
  undeclare(url: string, key: string, scope: ScopeRef, name: string): Promise<void> {
    return this.transport.silo(url, key).project(scope.project).variables.undeclare(name, {
      environment: scope.env,
    })
  }

  /** Sets this environment's value. No other environment is touched. */
  setValue(
    url: string,
    key: string,
    scope: ScopeRef,
    name: string,
    value: string,
  ): Promise<Variable> {
    return this.transport.silo(url, key).scope(scope.project, scope.env).variables.set(name, value)
  }

  /** Clears this environment's value, leaving the name declared. */
  clearValue(url: string, key: string, scope: ScopeRef, name: string): Promise<Variable> {
    return this.transport.silo(url, key).scope(scope.project, scope.env).variables.unset(name)
  }
}
