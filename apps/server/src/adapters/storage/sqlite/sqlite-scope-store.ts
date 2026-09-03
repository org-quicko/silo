import type { SqliteConnection } from "./sqlite-connection";
import { EntryUtils } from "../../../core/domain/entry-utils";
import type { EnvironmentRecord } from "../../../core/domain/environment-record";
import type { ProjectRecord } from "../../../core/domain/project-record";
import { Scope } from "../../../core/domain/scope";
import { ConflictError } from "../../../core/errors/conflict-error";
import type { SqliteEntryStore } from "./sqlite-entry-store";
import { SqliteIdClaim } from "./sqlite-id-claim";
import { SqliteRecordMapper } from "./sqlite-record-mapper";
import type { SqliteScopeResolver } from "./sqlite-scope-resolver";

/**
 * Projects and environments as keyed records (D51).
 *
 * Every listing is a plain select. Under D20 it was a union of the explicit
 * rows with the scopes that schemas and entries implied, because a scope could
 * exist by holding content alone; a child now references its parent by id and
 * so cannot outlive it, which makes the record the only answer.
 */
export class SqliteScopeStore {
  private readonly database: SqliteConnection;
  private readonly entries: SqliteEntryStore;
  private readonly resolver: SqliteScopeResolver;

  constructor(database: SqliteConnection, entries: SqliteEntryStore, resolver: SqliteScopeResolver) {
    this.database = database;
    this.entries = entries;
    this.resolver = resolver;
  }

  createProject(name: string, id?: string): ProjectRecord {
    EntryUtils.assertSafeSegment(name, "project");

    const existing = this.findProject(name);
    if (existing) return existing;

    const now = EntryUtils.now().toISOString();
    const recordId = this.claimId(id, "project");
    this.database
      .query(`INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`)
      .run(recordId, name, now, now);
    this.resolver.clear();

    return { id: recordId, name, created_at: new Date(now), updated_at: new Date(now) };
  }

  listProjects(): ProjectRecord[] {
    const rows = this.database
      .query(
        `SELECT id, name, created_at, updated_at FROM projects
         WHERE SUBSTR(name, 1, 1) != '_' ORDER BY name`
      )
      .all() as any[];
    return rows.map(SqliteRecordMapper.toProject);
  }

  findProject(name: string): ProjectRecord | null {
    const row = this.database
      .query(`SELECT id, name, created_at, updated_at FROM projects WHERE name = ?`)
      .get(name) as any;
    return row ? SqliteRecordMapper.toProject(row) : null;
  }

  renameProject(id: string, name: string): void {
    EntryUtils.assertSafeSegment(name, "project");

    this.database.transaction(() => {
      const current = this.requireProject(id);
      if (current.name === name) return;

      const taken = this.findProject(name);
      if (taken) {
        throw new ConflictError(`project "${name}" already exists`);
      }
      this.touchName("projects", id, name);
    })();
    this.resolver.clear();
  }

  deleteProject(name: string): void {
    EntryUtils.assertSafeSegment(name, "project");

    this.database.transaction(() => {
      const project = this.findProject(name);
      if (!project) return;

      // Entries first, and their media references and index rows go with them
      // through `ON DELETE CASCADE`. Then the records, innermost outwards:
      // `entries` references `collections` and `collections` references
      // `environments` with no cascade of their own, deliberately, so a
      // mis-ordered delete is refused rather than silently orphaning content.
      this.entries.purgeProject(project.id);
      this.database.query(`DELETE FROM collections WHERE project_id = ?`).run(project.id);
      this.database.query(`DELETE FROM environments WHERE project_id = ?`).run(project.id);
      this.database.query(`DELETE FROM projects WHERE id = ?`).run(project.id);
    })();
    this.resolver.clear();
  }

  /** The project record is implied by the environment, so both are written. */
  createEnvironment(project: string, env: string, id?: string): EnvironmentRecord {
    EntryUtils.assertSafeSegment(project, "project");
    EntryUtils.assertSafeSegment(env, "env");

    let record!: EnvironmentRecord;
    this.database.transaction(() => {
      const parent = this.createProject(project);
      const existing = this.readEnvironment(parent.id, env);
      if (existing) {
        record = existing;
        return;
      }

      const now = EntryUtils.now().toISOString();
      const recordId = this.claimId(id, "env");
      this.database
        .query(
          `INSERT INTO environments (id, project_id, name, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(recordId, parent.id, env, now, now);
      record = {
        id: recordId,
        project_id: parent.id,
        name: env,
        created_at: new Date(now),
        updated_at: new Date(now),
      };
    })();
    this.resolver.clear();

    return record;
  }

  listEnvironments(project: string): EnvironmentRecord[] {
    const projectId = this.resolver.projectId(project);
    if (projectId === null) return [];

    const rows = this.database
      .query(
        `SELECT id, project_id, name, created_at, updated_at FROM environments
         WHERE project_id = ? AND SUBSTR(name, 1, 1) != '_' ORDER BY name`
      )
      .all(projectId) as any[];
    return rows.map(SqliteRecordMapper.toEnvironment);
  }

  findEnvironment(project: string, env: string): EnvironmentRecord | null {
    const projectId = this.resolver.projectId(project);
    return projectId === null ? null : this.readEnvironment(projectId, env);
  }

  renameEnvironment(id: string, name: string): void {
    EntryUtils.assertSafeSegment(name, "env");

    this.database.transaction(() => {
      const current = this.requireEnvironment(id);
      if (current.name === name) return;

      const taken = this.readEnvironment(current.project_id, name);
      if (taken) {
        throw new ConflictError(`environment "${name}" already exists in this project`);
      }
      this.touchName("environments", id, name);
    })();
    this.resolver.clear();
  }

  deleteEnvironment(project: string, env: string): void {
    EntryUtils.assertSafeSegment(project, "project");
    EntryUtils.assertSafeSegment(env, "env");

    this.database.transaction(() => {
      const record = this.findEnvironment(project, env);
      if (!record) return;

      this.entries.purgeEnvironment(record.id);
      this.database.query(`DELETE FROM collections WHERE env_id = ?`).run(record.id);
      this.database.query(`DELETE FROM environments WHERE id = ?`).run(record.id);
    })();
    this.resolver.clear();
  }

  listScopes(): Scope[] {
    const rows = this.database
      .query(
        `SELECT p.name AS project, e.name AS env
         FROM environments e JOIN projects p ON p.id = e.project_id
         WHERE SUBSTR(p.name, 1, 1) != '_' AND SUBSTR(e.name, 1, 1) != '_'
         ORDER BY p.name, e.name`
      )
      .all() as { project: string; env: string }[];

    const scopes: Scope[] = [];
    for (const row of rows) {
      // A row that does not conform to the id grammar (a hand-edited database,
      // a bug elsewhere) is skipped rather than allowed to crash every caller —
      // export in particular.
      try {
        scopes.push(Scope.of(row.project, row.env));
      } catch {
        continue;
      }
    }
    return scopes;
  }

  /**
   * The scope's ids, creating the project and environment records if they are
   * missing.
   *
   * Both are pure containers, so creating one implicitly needs nothing the
   * caller has not already supplied. A **collection** is not, since its schema
   * is `NOT NULL`, which is why `putSchema` is the only thing that creates one
   * and an entry written to a collection that does not exist is refused.
   */
  ensureScope(scope: Scope): { projectId: string; envId: string } {
    const environment = this.createEnvironment(scope.project, scope.env);
    return { projectId: environment.project_id, envId: environment.id };
  }

  private readEnvironment(projectId: string, env: string): EnvironmentRecord | null {
    const row = this.database
      .query(
        `SELECT id, project_id, name, created_at, updated_at FROM environments
         WHERE project_id = ? AND name = ?`
      )
      .get(projectId, env) as any;
    return row ? SqliteRecordMapper.toEnvironment(row) : null;
  }

  private requireProject(id: string): ProjectRecord {
    const row = this.database
      .query(`SELECT id, name, created_at, updated_at FROM projects WHERE id = ?`)
      .get(id) as any;
    if (!row) throw SqliteRecordMapper.noSuchRecord("project", id);
    return SqliteRecordMapper.toProject(row);
  }

  private requireEnvironment(id: string): EnvironmentRecord {
    const row = this.database
      .query(
        `SELECT id, project_id, name, created_at, updated_at FROM environments WHERE id = ?`
      )
      .get(id) as any;
    if (!row) throw SqliteRecordMapper.noSuchRecord("environment", id);
    return SqliteRecordMapper.toEnvironment(row);
  }

  private touchName(table: "projects" | "environments", id: string, name: string): void {
    this.database
      .query(`UPDATE ${table} SET name = ?, updated_at = ? WHERE id = ?`)
      .run(name, EntryUtils.now().toISOString(), id);
  }

  private claimId(id: string | undefined, label: string): string {
    return SqliteIdClaim.claim(this.database, id, label);
  }
}
