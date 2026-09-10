import type { RequestOptions } from "../request-options.js";
import { ApiPath } from "../transport/api-path.js";
import type { Transport } from "../transport/transport.js";
import { Variable } from "./variable.js";
import type { VariableDeclaration } from "./variable-declaration.js";

/** `declare()`'s options: `environment` is where the initial `value` lands,
 *  when one is given at all. */
export interface DeclareVariableOptions extends RequestOptions {
  description?: string;
  environment?: string;
  value?: string;
}

/**
 * `rename()`/`describe()`/`undeclare()`'s options. `environment` is not
 * load-bearing for what these three do — declaring, renaming and
 * undeclaring reach every environment in the project regardless of which one
 * is named (`VariableService.updateDeclaration`/`undeclare` only ever
 * rewrite the one project-wide record). It still matters for two things: the
 * scope has to resolve to a real environment at all, and — for `rename`/
 * `describe` only — it picks which environment's `value` comes back on the
 * `Variable` the call answers. Left unset, the server assumes `"prod"`
 * (`Scope.Default`), which is a 404 waiting to happen for a project that
 * never created one; set it explicitly for any other project shape.
 */
export interface VariableEnvironmentOptions extends RequestOptions {
  environment?: string;
}

/** Declarations within one project: `declare`, `rename`, `describe`,
 *  `undeclare`. Values live on `EnvironmentVariables` instead. */
export class ProjectVariables {
  constructor(
    private readonly transport: Transport,
    private readonly project: string,
  ) {}

  async declare(name: string, options: DeclareVariableOptions = {}): Promise<Variable> {
    const payload = await this.transport.json<VariableDeclaration>({
      method: "POST",
      path: ApiPath.projectVariables(this.project),
      query: { env: options.environment },
      body: { name, description: options.description, value: options.value },
      signal: options.signal,
      timeoutMilliseconds: options.timeoutMilliseconds,
    });
    return Variable.fromWire(payload);
  }

  async rename(name: string, to: string, options: VariableEnvironmentOptions = {}): Promise<Variable> {
    return this.updateDeclaration(name, { name: to }, options);
  }

  async describe(name: string, description: string, options: VariableEnvironmentOptions = {}): Promise<Variable> {
    return this.updateDeclaration(name, { description }, options);
  }

  /** Forgets the name and every environment's value with it. */
  async undeclare(name: string, options: VariableEnvironmentOptions = {}): Promise<void> {
    await this.transport.empty({
      method: "DELETE",
      path: ApiPath.projectVariable(this.project, name),
      query: { env: options.environment },
      signal: options.signal,
      timeoutMilliseconds: options.timeoutMilliseconds,
    });
  }

  private async updateDeclaration(
    name: string,
    body: { name?: string; description?: string },
    options: VariableEnvironmentOptions,
  ): Promise<Variable> {
    const payload = await this.transport.json<VariableDeclaration>({
      method: "PATCH",
      path: ApiPath.projectVariable(this.project, name),
      query: { env: options.environment },
      body,
      signal: options.signal,
      timeoutMilliseconds: options.timeoutMilliseconds,
    });
    return Variable.fromWire(payload);
  }
}
