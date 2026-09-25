import { EntryUtils } from "../../../core/domain/entry-utils";
import { ConflictError } from "../../../core/errors/conflict-error";
import type { PgQueryable } from "./pg-queryable";
import type { PgTables } from "./pg-tables";

/**
 * A record id supplied by a caller, checked, or a fresh one (D51). The rules
 * are `SqliteIdClaim`'s: validated like a segment, `_` reserved, and unique
 * across all three record tables.
 *
 * The check and the insert that follows are two statements, so two writers
 * could both pass it with the same id. The primary key still refuses the
 * second, as a `ConflictError`; the check exists for the clearer message.
 */
export class PgIdClaim {
  static async claim(
    database: PgQueryable,
    tables: PgTables,
    id: string | undefined,
    label: string
  ): Promise<string> {
    if (id === undefined) return EntryUtils.newID();

    EntryUtils.assertSafeSegment(id, `${label} id`);
    if (id.startsWith("_")) {
      throw new ConflictError(`record id "${id}" is reserved`);
    }
    const taken = await database.query(
      `SELECT 1 FROM ${tables.projects} WHERE id = $1
       UNION ALL SELECT 1 FROM ${tables.environments} WHERE id = $1
       UNION ALL SELECT 1 FROM ${tables.collections} WHERE id = $1`,
      [id]
    );
    if (taken.length > 0) throw new ConflictError(`record id "${id}" is already in use`);
    return id;
  }
}
