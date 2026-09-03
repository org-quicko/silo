import type { Database, Statement } from "bun:sqlite";

/**
 * The database handle, and every statement prepared against it.
 *
 * bun:sqlite finalizes a statement only if it is still in `Database.query`'s
 * own cache when the database closes — and that cache holds twenty, so the
 * twenty-first distinct statement silently evicts the first, and an evicted
 * statement is never finalized. `Database.prepare` is not cached at all.
 * Either way an unfinalized statement keeps the file open, which is why this
 * cache is owned and unbounded: `close()` finalizes every statement it ever
 * prepared, so it *releases* the file rather than merely stopping using it.
 * See docs/design/storage.md.
 */
export class SqliteConnection {
  private readonly database: Database;
  private readonly statements = new Map<string, Statement>();

  constructor(database: Database) {
    this.database = database;
  }

  /** A cached statement, for SQL whose text is fixed. */
  query(sql: string): Statement {
    const cached = this.statements.get(sql);
    if (cached) return cached;
    const statement = this.database.prepare(sql);
    this.statements.set(sql, statement);
    return statement;
  }

  /**
   * A statement for SQL built per call: prepared, used, finalized.
   *
   * A compiled filter or an `IN` list sized to its arguments has a different
   * text nearly every time, so caching it would grow the map by one live
   * statement per shape — bounded by the workload rather than by the code.
   */
  once<T>(sql: string, use: (statement: Statement) => T): T {
    const statement = this.database.prepare(sql);
    try {
      return use(statement);
    } finally {
      statement.finalize();
    }
  }

  exec(sql: string, ...parameters: any[]): void {
    this.database.exec(sql, ...parameters);
  }

  transaction(insideTransaction: (...args: any[]) => any) {
    return this.database.transaction(insideTransaction);
  }

  /** Finalizes every cached statement, then closes the database. */
  close(): void {
    for (const statement of this.statements.values()) statement.finalize();
    this.statements.clear();
    this.database.close();
  }
}
