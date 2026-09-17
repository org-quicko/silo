import type { RequestOptions } from "../request-options.js";
import type { ScopeReference } from "../scope/scope-reference.js";
import { ApiPath } from "../transport/api-path.js";
import { Variable } from "./variable.js";
import type { VariableDeclaration } from "./variable-declaration.js";

/** This environment's values: `list`, `set`, `unset`. Declaring, renaming
 *  and undeclaring a name are project-wide and live on `ProjectVariables`. */
export class EnvironmentVariables {
  constructor(private readonly scope: ScopeReference) {}

  async list(options: RequestOptions = {}): Promise<Variable[]> {
    const body = await this.scope.transport.json<{ items: VariableDeclaration[] }>({
      method: "GET",
      path: ApiPath.environmentVariables(this.scope.project, this.scope.environment),
      ...options,
    });
    return body.items.map(Variable.fromWire);
  }

  async set(name: string, value: string, options: RequestOptions = {}): Promise<Variable> {
    const payload = await this.scope.transport.json<VariableDeclaration>({
      method: "PUT",
      path: ApiPath.environmentVariable(this.scope.project, this.scope.environment, name),
      body: { value },
      ...options,
    });
    return Variable.fromWire(payload);
  }

  /** Clears this environment's value, leaving the name declared — the server
   *  answers the updated declaration rather than `204`. */
  async unset(name: string, options: RequestOptions = {}): Promise<Variable> {
    const payload = await this.scope.transport.json<VariableDeclaration>({
      method: "DELETE",
      path: ApiPath.environmentVariable(this.scope.project, this.scope.environment, name),
      ...options,
    });
    return Variable.fromWire(payload);
  }
}
