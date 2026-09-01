import type { Database } from "bun:sqlite";
import { EntryUtils } from "../../../core/domain/entry-utils";
import { ConflictError } from "../../../core/errors/conflict-error";

/**
 * A record id supplied by a caller, checked, or a fresh one (D51).
 *
 * Import carries ids in its markers and must be able to preserve them, so the
 * create paths accept one. A supplied id is still caller data: it is validated
 * like any other segment and refused when anything already holds it, rather
 * than replaced by a mint that would quietly lose the archive's identity and
 * leave two records where the operator expected one.
 *
 * Uniqueness is checked across **all three** tables, not just the one being
 * written. Nothing requires that, and a project and a collection could safely
 * share an id — but an id that means one thing in one table and another
 * elsewhere makes every log line and every bug report ambiguous.
 */
export class SqliteIdClaim {
  static claim(database: Database, id: string | undefined, label: string): string {
    if (id === undefined) return EntryUtils.newID();

    EntryUtils.assertSafeSegment(id, `${label} id`);
    // The reserved records own the `_`-prefixed ids — `_system`, `_keys` and
    // the rest are literal rather than minted, so that every instance and every
    // archive addresses them identically. Refusing the prefix outright is why
    // nothing has to scan them for collisions.
    if (id.startsWith("_")) {
      throw new ConflictError(`record id "${id}" is reserved`);
    }
    const taken = database
      .prepare(
        `SELECT 1 AS found FROM projects WHERE id = ?
         UNION ALL SELECT 1 FROM environments WHERE id = ?
         UNION ALL SELECT 1 FROM collections WHERE id = ?`
      )
      .get(id, id, id) as { found: number } | undefined;

    if (taken) throw new ConflictError(`record id "${id}" is already in use`);
    return id;
  }
}
