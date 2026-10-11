import type { Meta } from "../../../core/domain/meta";
import type { PgQueryable } from "./pg-queryable";
import type { PgTables } from "./pg-tables";

/** The `meta` key/value table: the instance id and the `seq` counter. */
export class PgMetaStore {
  private readonly database: PgQueryable;
  private readonly tables: PgTables;

  constructor(database: PgQueryable, tables: PgTables) {
    this.database = database;
    this.tables = tables;
  }

  /**
   * Reserves the next `seq`, inside the caller's write transaction.
   *
   * A counter row rather than a `SEQUENCE`: the `UPDATE` holds the row lock
   * until the transaction ends, so the next writer waits and takes the next
   * number. `seq` then has no gaps, and its order is commit order, which a
   * change feed (D6) reads as the order things happened in.
   */
  async nextSeq(transaction: PgQueryable): Promise<number> {
    const [row] = await transaction.query<{ seq: string }>(
      `UPDATE ${this.tables.meta} SET value = (value::bigint + 1)::text
       WHERE key = 'last_seq' RETURNING value AS seq`
    );
    if (!row) throw new Error("failed to increment last_seq");
    return Number(row.seq);
  }

  async read(): Promise<Meta> {
    const rows = await this.database.query<{ key: string; value: string }>(
      `SELECT key, value FROM ${this.tables.meta}
       WHERE key IN ('instance_id', 'last_seq', 'defaults_initialized')`
    );
    const value = new Map(rows.map((row) => [row.key, row.value]));
    return {
      instance_id: value.get("instance_id") ?? "",
      last_seq: Number(value.get("last_seq") ?? 0),
      defaults_initialized: value.get("defaults_initialized") === "1",
    };
  }

  async markDefaultsInitialized(): Promise<void> {
    await this.database.query(
      `INSERT INTO ${this.tables.meta} (key, value) VALUES ('defaults_initialized', '1')
       ON CONFLICT (key) DO UPDATE SET value = '1'`
    );
  }
}
