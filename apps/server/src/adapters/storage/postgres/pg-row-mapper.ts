import type { Entry } from "../../../core/domain/entry";
import type { Scope } from "../../../core/domain/scope";

/** Converts between an `entries` row and an `Entry`. */
export class PgRowMapper {
  static readonly Columns = "id, rev, seq, created_at, updated_at, data";

  /**
   * For a single-scope read, where the caller named the scope and collection,
   * for the reason `SqliteRowMapper.toScopedEntry` gives.
   *
   * `rev` and `seq` are `bigint`, which the driver returns as strings. `data`
   * arrives already parsed from `jsonb`.
   */
  static toScopedEntry(row: any, scope: Scope, collection: string): Entry {
    return {
      id: row.id,
      project: scope.project,
      env: scope.env,
      collection,
      rev: Number(row.rev),
      seq: Number(row.seq),
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
      data: row.data,
    };
  }

  /** Timestamps are stored as ISO strings; callers may hand over either form. */
  static isoDate(value: Date | string): string {
    return typeof value === "string" ? value : value.toISOString();
  }
}
