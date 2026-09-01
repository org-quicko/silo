import fs from "fs/promises";
import path from "path";
import { EntryUtils } from "../../../core/domain/entry-utils";
import type { EnvironmentRecord } from "../../../core/domain/environment-record";
import type { ProjectRecord } from "../../../core/domain/project-record";
import { Scope } from "../../../core/domain/scope";
import { ConflictError } from "../../../core/errors/conflict-error";
import { NotFoundError } from "../../../core/errors/not-found-error";
import { FsFiles } from "./fs-files";
import { FsLayout } from "./fs-layout";
import { FsMarker } from "./fs-marker";

/**
 * Projects and environments as directories plus marker files (D51).
 *
 * The marker is no longer only evidence that a scope was created explicitly: it
 * holds the record's **id**, so it is now required, and a directory without one
 * is not a scope. That replaces D20's rule, where a scope existed if it was
 * created *or* still held content — a reading that has no answer to "what is
 * this scope's id".
 *
 * A rename is one `fs.rename` of the directory, atomic on one filesystem, and
 * the marker inside travels untouched.
 */
export class FsScopeStore {
  private readonly layout: FsLayout;

  constructor(layout: FsLayout) {
    this.layout = layout;
  }

  async createProject(name: string, id?: string): Promise<ProjectRecord> {
    EntryUtils.assertSafeSegment(name, "project");

    const existing = await this.findProject(name);
    if (existing) return existing;

    const projectDir = this.layout.projectDir(name);
    await fs.mkdir(projectDir, { recursive: true });
    const marker = await FsMarker.write(
      path.join(projectDir, FsLayout.ProjectMarker),
      await this.claimId(id, "project")
    );
    return { id: marker.id, name, created_at: marker.created_at, updated_at: marker.created_at };
  }

  async listProjects(): Promise<ProjectRecord[]> {
    const records: ProjectRecord[] = [];
    for (const name of await FsFiles.readSubdirs(this.layout.projectsDir)) {
      const record = await this.findProject(name);
      if (record) records.push(record);
    }
    return records.sort((left, right) => left.name.localeCompare(right.name));
  }

  async findProject(name: string): Promise<ProjectRecord | null> {
    const marker = await FsMarker.read(
      path.join(this.layout.projectDir(name), FsLayout.ProjectMarker)
    );
    if (!marker) return null;
    return { id: marker.id, name, created_at: marker.created_at, updated_at: marker.created_at };
  }

  async renameProject(id: string, name: string): Promise<void> {
    EntryUtils.assertSafeSegment(name, "project");

    const current = await this.projectById(id);
    if (current.name === name) return;
    if (await this.findProject(name)) {
      throw new ConflictError(`project "${name}" already exists`);
    }
    await fs.rename(this.layout.projectDir(current.name), this.layout.projectDir(name));
  }

  async deleteProject(name: string): Promise<void> {
    EntryUtils.assertSafeSegment(name, "project");
    await fs.rm(this.layout.projectDir(name), { recursive: true, force: true });
  }

  /** The project marker is written too, so a project reached only through
   *  `createEnvironment` is listed — the same rule SQLite's insert implies. */
  async createEnvironment(project: string, env: string, id?: string): Promise<EnvironmentRecord> {
    EntryUtils.assertSafeSegment(project, "project");
    EntryUtils.assertSafeSegment(env, "env");

    const parent = await this.createProject(project);
    const existing = await this.readEnvironment(parent.id, project, env);
    if (existing) return existing;

    const envDir = this.layout.envDir(project, env);
    await fs.mkdir(envDir, { recursive: true });
    const marker = await FsMarker.write(
      path.join(envDir, FsLayout.EnvMarker),
      await this.claimId(id, "env")
    );
    return {
      id: marker.id,
      project_id: parent.id,
      name: env,
      created_at: marker.created_at,
      updated_at: marker.created_at,
    };
  }

  async listEnvironments(project: string): Promise<EnvironmentRecord[]> {
    const parent = await this.findProject(project);
    if (!parent) return [];

    const records: EnvironmentRecord[] = [];
    for (const env of await FsFiles.readSubdirs(this.layout.projectDir(project))) {
      const record = await this.readEnvironment(parent.id, project, env);
      if (record) records.push(record);
    }
    return records.sort((left, right) => left.name.localeCompare(right.name));
  }

  async findEnvironment(project: string, env: string): Promise<EnvironmentRecord | null> {
    const parent = await this.findProject(project);
    return parent ? this.readEnvironment(parent.id, project, env) : null;
  }

  async renameEnvironment(id: string, name: string): Promise<void> {
    EntryUtils.assertSafeSegment(name, "env");

    const found = await this.environmentById(id);
    if (found.record.name === name) return;
    if (await this.findEnvironment(found.project, name)) {
      throw new ConflictError(`environment "${name}" already exists in this project`);
    }
    await fs.rename(
      this.layout.envDir(found.project, found.record.name),
      this.layout.envDir(found.project, name)
    );
  }

  async deleteEnvironment(project: string, env: string): Promise<void> {
    EntryUtils.assertSafeSegment(project, "project");
    EntryUtils.assertSafeSegment(env, "env");
    await fs.rm(this.layout.envDir(project, env), { recursive: true, force: true });
  }

  async listScopes(): Promise<Scope[]> {
    const scopes: Scope[] = [];
    for (const project of await FsFiles.readSubdirs(this.layout.projectsDir)) {
      if (!(await this.findProject(project))) continue;

      for (const env of await FsFiles.readSubdirs(this.layout.projectDir(project))) {
        if (!(await FsMarker.read(path.join(this.layout.envDir(project, env), FsLayout.EnvMarker)))) {
          continue;
        }
        // A directory pair that does not conform to the id grammar (a
        // hand-edited data dir, a bug elsewhere) is skipped rather than
        // allowed to crash every caller — export in particular.
        try {
          scopes.push(Scope.of(project, env));
        } catch {
          continue;
        }
      }
    }

    scopes.sort(
      (left, right) =>
        left.project.localeCompare(right.project) || left.env.localeCompare(right.env)
    );
    return scopes;
  }

  /** Creates the project and environment records if they are missing. */
  async ensureScope(scope: Scope): Promise<EnvironmentRecord> {
    return this.createEnvironment(scope.project, scope.env);
  }

  /**
   * Which project holds this id.
   *
   * A scan, because the tree is organised by name — the price of a layout a
   * human can read, and bounded by the number of projects. The fs adapter is
   * O(n)-per-query by design (D5, §6.3).
   */
  private async projectById(id: string): Promise<ProjectRecord> {
    for (const record of await this.listProjects()) {
      if (record.id === id) return record;
    }
    throw new NotFoundError(`no project with id "${id}"`);
  }

  private async environmentById(
    id: string
  ): Promise<{ project: string; record: EnvironmentRecord }> {
    for (const project of await this.listProjects()) {
      for (const record of await this.listEnvironments(project.name)) {
        if (record.id === id) return { project: project.name, record };
      }
    }
    throw new NotFoundError(`no environment with id "${id}"`);
  }

  private async readEnvironment(
    projectId: string,
    project: string,
    env: string
  ): Promise<EnvironmentRecord | null> {
    const marker = await FsMarker.read(
      path.join(this.layout.envDir(project, env), FsLayout.EnvMarker)
    );
    if (!marker) return null;
    return {
      id: marker.id,
      project_id: projectId,
      name: env,
      created_at: marker.created_at,
      updated_at: marker.created_at,
    };
  }

  /**
   * A supplied id, checked against the projects and environments on disk, or a
   * fresh one. The same rule SQLite states: an archive's id is preserved when
   * it is free and refused when it is not, never silently replaced.
   */
  private async claimId(id: string | undefined, label: string): Promise<string> {
    if (id === undefined) return EntryUtils.newID();
    EntryUtils.assertSafeSegment(id, `${label} id`);
    if (id.startsWith("_")) {
      throw new ConflictError(`record id "${id}" is reserved`);
    }

    for (const project of await this.listProjects()) {
      if (project.id === id) throw new ConflictError(`record id "${id}" is already in use`);
      for (const env of await this.listEnvironments(project.name)) {
        if (env.id === id) throw new ConflictError(`record id "${id}" is already in use`);
      }
    }
    return id;
  }
}
