import type { Entry } from "../../../core/domain/entry";
import type { Scope } from "../../../core/domain/scope";

/** Converts between an `entries` row and an `Entry`. */
export class SqliteRowMapper {
  /**
   * For a row read across scopes, where the query joined the record tables and
   * so carries `project`, `env` and `collection` names of its own.
   */
  static toEntry(row: any): Entry {
    return SqliteRowMapper.build(row, row.project, row.env, row.collection);
  }

  /**
   * For a single-scope read, where the caller named the scope and collection on
   * the way in.
   *
   * The envelope carries names while the table stores ids (D51), and joining
   * three record tables to recover names the caller already holds would be
   * three joins per page to learn nothing new.
   */
  static toScopedEntry(row: any, scope: Scope, collection: string): Entry {
    return SqliteRowMapper.build(row, scope.project, scope.env, collection);
  }

  /** Timestamps are stored as ISO strings; callers may hand over either form. */
  static isoDate(value: Date | string): string {
    return typeof value === "string" ? value : value.toISOString();
  }

  private static build(row: any, project: string, env: string, collection: string): Entry {
    return {
      id: row.id,
      project,
      env,
      collection,
      rev: Number(row.rev),
      seq: Number(row.seq),
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
      data: JSON.parse(row.data),
    };
  }
}
