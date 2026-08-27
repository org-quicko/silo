import type { Database } from "bun:sqlite";
import { EntryUtils } from "../../../core/domain/entry-utils";
import type { Scope } from "../../../core/domain/scope";
import { NotFoundError } from "../../../core/errors/not-found-error";

/** The `schemas` table: one JSON Schema per collection per scope. */
export class SqliteSchemaStore {
  private readonly database: Database;

  constructor(database: Database) {
    this.database = database;
  }

  put(scope: Scope, collection: string, schema: any): void {
    this.database
      .prepare(
        `INSERT INTO schemas (project, env, collection, schema, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (project, env, collection) DO UPDATE SET
           schema = excluded.schema,
           updated_at = excluded.updated_at`
      )
      .run(
        scope.project,
        scope.env,
        collection,
        JSON.stringify(schema),
        EntryUtils.now().toISOString()
      );
  }

  get(scope: Scope, collection: string): any {
    const row = this.database
      .prepare(`SELECT schema FROM schemas WHERE project = ? AND env = ? AND collection = ?`)
      .get(scope.project, scope.env, collection) as { schema: string } | undefined;

    if (!row) throw SqliteSchemaStore.notFound(scope, collection);
    return JSON.parse(row.schema);
  }

  list(scope: Scope): Map<string, any> {
    const rows = this.database
      .prepare(`SELECT collection, schema FROM schemas WHERE project = ? AND env = ?`)
      .all(scope.project, scope.env) as { collection: string; schema: string }[];

    const schemas = new Map<string, any>();
    for (const row of rows) schemas.set(row.collection, JSON.parse(row.schema));
    return schemas;
  }

  delete(scope: Scope, collection: string): void {
    const result = this.database
      .prepare(`DELETE FROM schemas WHERE project = ? AND env = ? AND collection = ?`)
      .run(scope.project, scope.env, collection);

    if (result.changes === 0) throw SqliteSchemaStore.notFound(scope, collection);
  }

  private static notFound(scope: Scope, collection: string): NotFoundError {
    return new NotFoundError(`collection "${scope.key()}/${collection}" not found`);
  }
}
