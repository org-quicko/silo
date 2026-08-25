import type { Database } from "bun:sqlite";
import { EntryUtils } from "../../../core/domain/entry-utils";
import { Scope } from "../../../core/domain/scope";
import type { SqliteEntryStore } from "./sqlite-entry-store";

/**
 * Projects and environments as rows (D20), so an empty one can exist.
 *
 * Every listing unions the explicit rows with the scopes implied by schemas and
 * entries, which is the same "created explicitly *or* still holds content" rule
 * the fs adapter reaches through marker files.
 */
export class SqliteScopeStore {
  private readonly database: Database;
  private readonly entries: SqliteEntryStore;

  constructor(database: Database, entries: SqliteEntryStore) {
    this.database = database;
    this.entries = entries;
  }

  createProject(project: string): void {
    EntryUtils.assertSafeSegment(project, "project");
    const now = EntryUtils.now().toISOString();
    this.database
      .prepare(`INSERT OR IGNORE INTO projects (id, created_at, updated_at) VALUES (?, ?, ?)`)
      .run(project, now, now);
  }

  listProjects(): string[] {
    const rows = this.database
      .prepare(
        `SELECT DISTINCT id FROM (
           SELECT id FROM projects
           UNION SELECT project AS id FROM environments
           UNION SELECT project AS id FROM schemas
           UNION SELECT project AS id FROM entries
         ) WHERE SUBSTR(id, 1, 1) != '_' ORDER BY id`
      )
      .all() as { id: string }[];
    return rows.map((row) => row.id);
  }

  deleteProject(project: string): void {
    EntryUtils.assertSafeSegment(project, "project");

    this.database.transaction(() => {
      // Entries, their media references and their index rows go in the same
      // transaction as the project row. A layer above the port could intercept
      // this call but could not be atomic with it, which is why usages live on
      // `Storage` (D23) — otherwise the entries would vanish while their
      // references survived, leaving a media file blocked by referrers that no
      // longer exist.
      this.entries.purgeProject(project);
      this.database.prepare(`DELETE FROM schemas WHERE project = ?`).run(project);
      this.database.prepare(`DELETE FROM environments WHERE project = ?`).run(project);
      this.database.prepare(`DELETE FROM projects WHERE id = ?`).run(project);
    })();
  }

  /** The project row is implied by the environment row, so both are written. */
  createEnvironment(project: string, env: string): void {
    EntryUtils.assertSafeSegment(project, "project");
    EntryUtils.assertSafeSegment(env, "env");
    const now = EntryUtils.now().toISOString();

    this.database.transaction(() => {
      this.database
        .prepare(`INSERT OR IGNORE INTO projects (id, created_at, updated_at) VALUES (?, ?, ?)`)
        .run(project, now, now);
      this.database
        .prepare(
          `INSERT OR IGNORE INTO environments (project, id, created_at, updated_at) VALUES (?, ?, ?, ?)`
        )
        .run(project, env, now, now);
    })();
  }

  listEnvironments(project: string): string[] {
    EntryUtils.assertSafeSegment(project, "project");
    const rows = this.database
      .prepare(
        `SELECT DISTINCT id FROM (
           SELECT id FROM environments WHERE project = ?
           UNION SELECT env AS id FROM schemas WHERE project = ?
           UNION SELECT env AS id FROM entries WHERE project = ?
         ) WHERE SUBSTR(id, 1, 1) != '_' ORDER BY id`
      )
      .all(project, project, project) as { id: string }[];
    return rows.map((row) => row.id);
  }

  deleteEnvironment(project: string, env: string): void {
    EntryUtils.assertSafeSegment(project, "project");
    EntryUtils.assertSafeSegment(env, "env");

    this.database.transaction(() => {
      this.entries.purgeEnvironment(project, env);
      this.database
        .prepare(`DELETE FROM schemas WHERE project = ? AND env = ?`)
        .run(project, env);
      this.database
        .prepare(`DELETE FROM environments WHERE project = ? AND id = ?`)
        .run(project, env);
    })();
  }

  listScopes(): Scope[] {
    const rows = this.database
      .prepare(
        `SELECT DISTINCT project, env FROM (
           SELECT project, id AS env FROM environments
           UNION SELECT project, env FROM schemas
           UNION SELECT project, env FROM entries
         )`
      )
      .all() as { project: string; env: string }[];

    const scopes: Scope[] = [];
    for (const row of rows) {
      // Every `_`-prefixed project/env, not just the exact `_system/_system`
      // pair — the same exclusion rule the fs adapter applies (D18 §5.4).
      if (row.project.startsWith("_") || row.env.startsWith("_")) continue;

      // A row that does not conform to the id grammar (a hand-edited database,
      // a bug elsewhere) is skipped rather than allowed to crash every caller —
      // export in particular.
      try {
        scopes.push(Scope.of(row.project, row.env));
      } catch {
        continue;
      }
    }

    scopes.sort(
      (left, right) =>
        left.project.localeCompare(right.project) || left.env.localeCompare(right.env)
    );
    return scopes;
  }
}
