import type { RequestOptions } from "../request-options.js";
import { ApiPath } from "../transport/api-path.js";
import type { Transport } from "../transport/transport.js";
import { ProjectVariables } from "../variables/project-variables.js";
import type { DeleteOptions } from "./delete-options.js";
import { EnvironmentHandle } from "./environment-handle.js";
import { Environments } from "./environments.js";
import type { RenameOptions } from "./rename-options.js";
import { RenameReport, type RenamePreviewPayload } from "./rename-report.js";
import { ScopeReference } from "./scope-reference.js";

/**
 * One project, addressed by the name it was built with. Immutable: after a
 * rename this handle still addresses the name that no longer exists, and its
 * next call is a `NotFoundError`. Build a new handle for the new name.
 */
export class ProjectHandle {
  readonly environments: Environments;
  readonly variables: ProjectVariables;

  constructor(
    private readonly transport: Transport,
    readonly name: string,
  ) {
    this.environments = new Environments(transport, name);
    this.variables = new ProjectVariables(transport, name);
  }

  environment(name: string): EnvironmentHandle {
    return new EnvironmentHandle(new ScopeReference(this.transport, this.name, name));
  }

  async rename(name: string, options: RenameOptions = {}): Promise<RenameReport> {
    const payload = await this.transport.json<RenamePreviewPayload>({
      method: "PATCH",
      path: ApiPath.project(this.name),
      query: { dry_run: options.dryRun || undefined, expected_id: options.expectedId },
      body: { name },
      signal: options.signal,
      timeoutMilliseconds: options.timeoutMilliseconds,
    });
    return RenameReport.fromWire(payload);
  }

  async delete(options: DeleteOptions = {}): Promise<void> {
    await this.transport.empty({
      method: "DELETE",
      path: ApiPath.project(this.name),
      query: { force: options.force || undefined },
      signal: options.signal,
      timeoutMilliseconds: options.timeoutMilliseconds,
    });
  }
}
