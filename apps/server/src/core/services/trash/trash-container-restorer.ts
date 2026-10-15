import { isDeepStrictEqual } from "node:util";
import type { CollectionRecord } from "../../domain/collection-record";
import type { EnvironmentRecord } from "../../domain/environment-record";
import type { ProjectRecord } from "../../domain/project-record";
import { ConflictError } from "../../errors/conflict-error";
import type { ServiceContext } from "../support/service-context";
import type { TrashLocator } from "./trash-locator";
import type { TrashRestoreResult } from "./trash-restore-result";

/** Recreates containers before their descendants, recognizing writes journaled by an earlier attempt. */
export class TrashContainerRestorer {
  constructor(private readonly context: ServiceContext) {}

  async project(
    record: ProjectRecord,
    subjectId: string,
    rename: string | undefined,
    locator: TrashLocator,
    into: TrashRestoreResult,
    retry: boolean,
    start: (name?: string) => Promise<void>
  ): Promise<void> {
    const name = record.id === subjectId && rename ? rename : record.name;
    const taken = await this.context.store.findProject(name);
    if (taken && (!retry || taken.id !== record.id)) TrashContainerRestorer.refuse("project", name, taken.id, record.id);
    if (!taken) {
      await start(name);
      await this.context.store.createProject(name, record.id);
    }
    locator.remember("project", record.id, name);
    into.projects += 1;
    if (record.id === subjectId && rename) into.renamed_to = name;
  }

  async environment(
    record: EnvironmentRecord,
    subjectId: string,
    rename: string | undefined,
    locator: TrashLocator,
    into: TrashRestoreResult,
    retry: boolean,
    start: (name?: string) => Promise<void>
  ): Promise<void> {
    const project = await locator.projectName(record.project_id);
    if (!project) throw new ConflictError(`project for environment "${record.name}" no longer exists`);
    const name = record.id === subjectId && rename ? rename : record.name;
    const taken = await this.context.store.findEnvironment(project, name);
    if (taken && (!retry || taken.id !== record.id)) TrashContainerRestorer.refuse("environment", name, taken.id, record.id);
    if (!taken) {
      await start(name);
      await this.context.store.createEnvironment(project, name, record.id);
    }
    locator.remember("environment", record.id, name);
    into.environments += 1;
    if (record.id === subjectId && rename) into.renamed_to = name;
  }

  async collection(
    record: CollectionRecord,
    subjectId: string,
    rename: string | undefined,
    locator: TrashLocator,
    into: TrashRestoreResult,
    retry: boolean,
    start: (name?: string) => Promise<void>
  ): Promise<void> {
    const scope = await locator.scopeOf(record.project_id, record.env_id);
    if (!scope) throw new ConflictError(`scope for collection "${record.name}" no longer exists`);
    const name = record.id === subjectId && rename ? rename : record.name;
    const taken = await this.context.store.findCollection(scope, name);
    if (taken && (!retry || taken.id !== record.id || !isDeepStrictEqual(taken.schema, record.schema))) {
      TrashContainerRestorer.refuse("collection", name, taken.id, record.id);
    }
    if (!taken) {
      await start(name);
      await this.context.store.putSchema(scope, name, record.schema, record.id);
    }
    locator.remember("collection", record.id, name);
    this.context.schemaRegistry.invalidate();
    into.collections += 1;
    if (record.id === subjectId && rename) into.renamed_to = name;
  }

  /** A live record unrelated to this replay is never overwritten. */
  private static refuse(kind: string, name: string, takenBy: string, restoring: string): never {
    throw new ConflictError(
      takenBy === restoring
        ? `${kind} "${name}" already exists`
        : `${kind} "${name}" was created after this was deleted; restore it under another name`
    );
  }
}
