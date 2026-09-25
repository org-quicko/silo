import { EntryUtils } from "../../../core/domain/entry-utils";
import type { EnvironmentRecord } from "../../../core/domain/environment-record";
import type { ProjectRecord } from "../../../core/domain/project-record";
import { Scope } from "../../../core/domain/scope";
import { ConflictError } from "../../../core/errors/conflict-error";
import type { PgConnection } from "./pg-connection";
import type { PgEntryStore } from "./pg-entry-store";
import { PgIdClaim } from "./pg-id-claim";
import type { PgQueryable } from "./pg-queryable";
import { PgRecordMapper } from "./pg-record-mapper";
import type { PgScopeResolver } from "./pg-scope-resolver";
import type { PgTables } from "./pg-tables";

/**
 * Projects and environments as keyed records (D51), with the rules
 * `SqliteScopeStore` documents.
 *
 * Creates are `INSERT ... ON CONFLICT DO NOTHING` followed by a read, rather
 * than a read followed by an insert, so two requests creating the same name at
 * once both get the one record instead of one of them getting a unique
 * violation.
 */
export class PgScopeStore {
  private readonly connection: PgConnection;
  private readonly tables: PgTables;
  private readonly entries: PgEntryStore;
  private readonly resolver: PgScopeResolver;

  constructor(
    connection: PgConnection,
    tables: PgTables,
    entries: PgEntryStore,
    resolver: PgScopeResolver
  ) {
    this.connection = connection;
    this.tables = tables;
    this.entries = entries;
    this.resolver = resolver;
  }

  async createProject(name: string, id?: string): Promise<ProjectRecord> {
    EntryUtils.assertSafeSegment(name, "project");
    return this.resolver.invalidating(() =>
      this.connection.transaction((transaction) => this.insertProject(transaction, name, id))
    );
  }

  async listProjects(): Promise<ProjectRecord[]> {
    const rows = await this.connection.query(
      `SELECT ${PgRecordMapper.ProjectColumns} FROM ${this.tables.projects}
       WHERE left(name, 1) <> '_' ORDER BY name`
    );
    return rows.map(PgRecordMapper.toProject);
  }

  async findProject(name: string): Promise<ProjectRecord | null> {
    return this.readProject(this.connection, name);
  }

  async renameProject(id: string, name: string): Promise<void> {
    EntryUtils.assertSafeSegment(name, "project");

    await this.resolver.invalidating(() =>
      this.connection.transaction(async (transaction) => {
        const [current] = await transaction.query(
          `SELECT name FROM ${this.tables.projects} WHERE id = $1 FOR UPDATE`,
          [id]
        );
        if (!current) throw PgRecordMapper.noSuchRecord("project", id);
        if (current.name === name) return;

        if (await this.readProject(transaction, name)) {
          throw new ConflictError(`project "${name}" already exists`);
        }
        await this.touchName(transaction, this.tables.projects, id, name);
      })
    );
  }

  /** Entries first, then the records innermost outwards, for the reason
   *  `SqliteScopeStore.deleteProject` gives. */
  async deleteProject(name: string): Promise<void> {
    EntryUtils.assertSafeSegment(name, "project");

    await this.resolver.invalidating(() =>
      this.connection.transaction(async (transaction) => {
        const project = await this.readProject(transaction, name);
        if (!project) return;

        await this.entries.purgeProject(transaction, project.id);
        await transaction.query(`DELETE FROM ${this.tables.collections} WHERE project_id = $1`, [
          project.id,
        ]);
        await transaction.query(`DELETE FROM ${this.tables.environments} WHERE project_id = $1`, [
          project.id,
        ]);
        await transaction.query(`DELETE FROM ${this.tables.projects} WHERE id = $1`, [project.id]);
      })
    );
  }

  /** The project record is implied by the environment, so both are written. */
  async createEnvironment(project: string, env: string, id?: string): Promise<EnvironmentRecord> {
    EntryUtils.assertSafeSegment(project, "project");
    EntryUtils.assertSafeSegment(env, "env");

    return this.resolver.invalidating(() =>
      this.connection.transaction((transaction) =>
        this.insertEnvironment(transaction, project, env, id)
      )
    );
  }

  async listEnvironments(project: string): Promise<EnvironmentRecord[]> {
    const projectId = await this.resolver.projectId(project);
    if (projectId === null) return [];

    const rows = await this.connection.query(
      `SELECT ${PgRecordMapper.EnvironmentColumns} FROM ${this.tables.environments}
       WHERE project_id = $1 AND left(name, 1) <> '_' ORDER BY name`,
      [projectId]
    );
    return rows.map(PgRecordMapper.toEnvironment);
  }

  async findEnvironment(project: string, env: string): Promise<EnvironmentRecord | null> {
    const projectId = await this.resolver.projectId(project);
    return projectId === null ? null : this.readEnvironment(this.connection, projectId, env);
  }

  async renameEnvironment(id: string, name: string): Promise<void> {
    EntryUtils.assertSafeSegment(name, "env");

    await this.resolver.invalidating(() =>
      this.connection.transaction(async (transaction) => {
        const [current] = await transaction.query(
          `SELECT project_id, name FROM ${this.tables.environments} WHERE id = $1 FOR UPDATE`,
          [id]
        );
        if (!current) throw PgRecordMapper.noSuchRecord("environment", id);
        if (current.name === name) return;

        if (await this.readEnvironment(transaction, current.project_id, name)) {
          throw new ConflictError(`environment "${name}" already exists in this project`);
        }
        await this.touchName(transaction, this.tables.environments, id, name);
      })
    );
  }

  async deleteEnvironment(project: string, env: string): Promise<void> {
    EntryUtils.assertSafeSegment(project, "project");
    EntryUtils.assertSafeSegment(env, "env");

    await this.resolver.invalidating(() =>
      this.connection.transaction(async (transaction) => {
        const parent = await this.readProject(transaction, project);
        const record = parent ? await this.readEnvironment(transaction, parent.id, env) : null;
        if (!record) return;

        await this.entries.purgeEnvironment(transaction, record.id);
        await transaction.query(`DELETE FROM ${this.tables.collections} WHERE env_id = $1`, [
          record.id,
        ]);
        await transaction.query(`DELETE FROM ${this.tables.environments} WHERE id = $1`, [
          record.id,
        ]);
      })
    );
  }

  async listScopes(): Promise<Scope[]> {
    const rows = await this.connection.query<{ project: string; env: string }>(
      `SELECT p.name AS project, e.name AS env
       FROM ${this.tables.environments} e JOIN ${this.tables.projects} p ON p.id = e.project_id
       WHERE left(p.name, 1) <> '_' AND left(e.name, 1) <> '_'
       ORDER BY p.name, e.name`
    );

    const scopes: Scope[] = [];
    for (const row of rows) {
      // Skipped rather than thrown, for the reason `SqliteScopeStore.listScopes` gives.
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
   * missing, inside the caller's transaction. See `SqliteScopeStore.ensureScope`
   * for why only these two are created implicitly.
   */
  async ensureScope(
    transaction: PgQueryable,
    scope: Scope
  ): Promise<{ projectId: string; envId: string }> {
    const environment = await this.insertEnvironment(transaction, scope.project, scope.env);
    return { projectId: environment.project_id, envId: environment.id };
  }

  private async insertProject(
    database: PgQueryable,
    name: string,
    id?: string
  ): Promise<ProjectRecord> {
    const existing = await this.readProject(database, name);
    if (existing) return existing;

    const recordId = await PgIdClaim.claim(database, this.tables, id, "project");
    const [row] = await database.query(
      `INSERT INTO ${this.tables.projects} (id, name, created_at, updated_at)
       VALUES ($1, $2, $3, $3)
       ON CONFLICT (name) DO NOTHING
       RETURNING ${PgRecordMapper.ProjectColumns}`,
      [recordId, name, EntryUtils.now().toISOString()]
    );
    if (row) return PgRecordMapper.toProject(row);
    return (await this.readProject(database, name))!;
  }

  private async insertEnvironment(
    database: PgQueryable,
    project: string,
    env: string,
    id?: string
  ): Promise<EnvironmentRecord> {
    const parent = await this.insertProject(database, project);
    const existing = await this.readEnvironment(database, parent.id, env);
    if (existing) return existing;

    const recordId = await PgIdClaim.claim(database, this.tables, id, "env");
    const [row] = await database.query(
      `INSERT INTO ${this.tables.environments} (id, project_id, name, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $4)
       ON CONFLICT (project_id, name) DO NOTHING
       RETURNING ${PgRecordMapper.EnvironmentColumns}`,
      [recordId, parent.id, env, EntryUtils.now().toISOString()]
    );
    if (row) return PgRecordMapper.toEnvironment(row);
    return (await this.readEnvironment(database, parent.id, env))!;
  }

  private async readProject(database: PgQueryable, name: string): Promise<ProjectRecord | null> {
    const [row] = await database.query(
      `SELECT ${PgRecordMapper.ProjectColumns} FROM ${this.tables.projects} WHERE name = $1`,
      [name]
    );
    return row ? PgRecordMapper.toProject(row) : null;
  }

  private async readEnvironment(
    database: PgQueryable,
    projectId: string,
    env: string
  ): Promise<EnvironmentRecord | null> {
    const [row] = await database.query(
      `SELECT ${PgRecordMapper.EnvironmentColumns} FROM ${this.tables.environments}
       WHERE project_id = $1 AND name = $2`,
      [projectId, env]
    );
    return row ? PgRecordMapper.toEnvironment(row) : null;
  }

  private async touchName(
    database: PgQueryable,
    table: string,
    id: string,
    name: string
  ): Promise<void> {
    await database.query(`UPDATE ${table} SET name = $1, updated_at = $2 WHERE id = $3`, [
      name,
      EntryUtils.now().toISOString(),
      id,
    ]);
  }
}
