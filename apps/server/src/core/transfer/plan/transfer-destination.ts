import type { Scope } from "../../domain/scope";
import type { Storage } from "../../ports/storage";

/**
 * The ids of the environment a transfer lands in (D111). The plan records
 * them, and Apply refuses an environment deleted or replaced since, even one
 * recreated under the same name.
 */
export class TransferDestination {
  /** The project and environment ids `to` names today, or null when either is gone. */
  static async ids(store: Storage, to: Scope): Promise<{ project_id: string; env_id: string } | null> {
    const project = await store.findProject(to.project);
    const env = project && (await store.findEnvironment(to.project, to.env));
    return project && env ? { project_id: project.id, env_id: env.id } : null;
  }
}
