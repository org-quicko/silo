import type { Entry } from "../../../core/domain/entry";

/** Converts between an `entries` row and an `Entry`. */
export class SqliteRowMapper {
  static toEntry(row: any): Entry {
    return {
      id: row.id,
      project: row.project,
      env: row.env,
      collection: row.collection,
      rev: Number(row.rev),
      seq: Number(row.seq),
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
      data: JSON.parse(row.data),
    };
  }

  /** Timestamps are stored as ISO strings; callers may hand over either form. */
  static isoDate(value: Date | string): string {
    return typeof value === "string" ? value : value.toISOString();
  }
}
