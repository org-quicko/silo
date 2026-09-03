import type { SqliteConnection } from "./sqlite-connection";
import type { Meta } from "../../../core/domain/meta";

/** The `meta` key/value table: the instance id and the `seq` counter. */
export class SqliteMetaStore {
  private readonly database: SqliteConnection;

  constructor(database: SqliteConnection) {
    this.database = database;
  }

  /**
   * Reserves the next `seq`. `UPDATE … RETURNING` makes the read and the
   * increment one statement, so two writers inside the same process cannot be
   * handed the same number.
   */
  nextSeq(): number {
    const row = this.database
      .query(
        `UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'last_seq' RETURNING CAST(value AS INTEGER) as seq`
      )
      .get() as { seq: number } | undefined;
    if (!row) throw new Error("failed to increment last_seq");
    return row.seq;
  }

  read(): Meta {
    const instanceId = this.database
      .query(`SELECT value FROM meta WHERE key = 'instance_id'`)
      .get() as { value: string } | undefined;
    const lastSeq = this.database
      .query(`SELECT CAST(value AS INTEGER) as seq FROM meta WHERE key = 'last_seq'`)
      .get() as { seq: number } | undefined;
    const seeded = this.database
      .query(`SELECT value FROM meta WHERE key = 'defaults_initialized'`)
      .get() as { value: string } | undefined;

    return {
      instance_id: instanceId ? instanceId.value : "",
      last_seq: lastSeq ? lastSeq.seq : 0,
      defaults_initialized: seeded ? seeded.value === "1" : false,
    };
  }

  markDefaultsInitialized(): void {
    this.database
      .query(`INSERT OR REPLACE INTO meta (key, value) VALUES ('defaults_initialized', '1')`)
      .run();
  }
}
