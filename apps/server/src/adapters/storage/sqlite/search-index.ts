import { Database } from "bun:sqlite";

/** How the index is configured, and what the stamp has to notice changing. */
export interface SearchIndexOptions {
  enabled: boolean;
  tokenizer: string;
}

/**
 * The FTS5 side of the SQLite adapter: the tables, the capability probe, and
 * the version stamp (D30).
 *
 * It is a separate class from `SqliteStore` but not a separate *transaction*:
 * the store writes index rows inside the transactions it already has, because
 * that is the only place they can be atomic with the entry write. See
 * `DerivedIndex` for why a decorator cannot do this.
 */
export class SearchIndex {
  static readonly Documents = "entry_search_documents";
  static readonly Fts = "entry_search_fts";

  /**
   * Bumped when the *shape* of the index changes — new columns, different
   * triggers. Together with the extractor version and the tokenizer it forms
   * the stamp; a change in any of them rebuilds everything.
   */
  static readonly EngineVersion = 2;
  /** Bumped when `SearchText.extract` would produce different text. */
  static readonly ExtractorVersion = 1;
  static readonly StampKey = "search_index_version";

  static stamp(tokenizer: string): string {
    return `${SearchIndex.EngineVersion}:${SearchIndex.ExtractorVersion}:${tokenizer}`;
  }

  /**
   * Whether this SQLite build can do FTS5 at all. Probed rather than assumed:
   * Bun links a different SQLite on different platforms, and the shipped build
   * sets `OMIT_LOAD_EXTENSION`, so a missing FTS5 cannot be repaired at
   * runtime — it can only be fallen back from.
   */
  static available(db: Database): boolean {
    try {
      db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS silo_fts_probe USING fts5(x)");
      db.exec("DROP TABLE IF EXISTS silo_fts_probe");
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Creates the tables, or drops and recreates them when the stamp has moved.
   * Returns true when the caller must refill the index — the tokenizer is
   * fixed into the virtual table at creation, so a tokenizer change is a
   * rebuild and not an update.
   */
  static install(db: Database, tokenizer: string): boolean {
    const want = SearchIndex.stamp(tokenizer);
    const row = db
      .prepare(`SELECT value FROM meta WHERE key = ?`)
      .get(SearchIndex.StampKey) as { value: string } | undefined;

    const stale = !row || row.value !== want;
    if (stale) SearchIndex.drop(db);

    db.exec(`
      CREATE TABLE IF NOT EXISTS ${SearchIndex.Documents} (
        docid         INTEGER PRIMARY KEY,
        project_id    TEXT NOT NULL,
        env_id        TEXT NOT NULL,
        collection_id TEXT NOT NULL,
        entry_id      TEXT NOT NULL,
        label         TEXT NOT NULL,
        body          TEXT NOT NULL,
        UNIQUE (collection_id, entry_id),
        FOREIGN KEY (collection_id, entry_id)
          REFERENCES entries(collection_id, id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_entry_search_scope
        ON ${SearchIndex.Documents}(env_id, collection_id);
      CREATE VIRTUAL TABLE IF NOT EXISTS ${SearchIndex.Fts} USING fts5(
        label, body,
        content = '${SearchIndex.Documents}',
        content_rowid = 'docid',
        tokenize = '${tokenizer}'
      );
    `);

    // External content keeps no copy of the text, so update and delete must
    // hand FTS5 the OLD values to remove the right terms — that is what the
    // documented `'delete'` command is for. Without it the index keeps terms
    // for text that no longer exists and searches return entries that no
    // longer match.
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS entry_search_ai AFTER INSERT ON ${SearchIndex.Documents} BEGIN
        INSERT INTO ${SearchIndex.Fts}(rowid, label, body) VALUES (new.docid, new.label, new.body);
      END;
      CREATE TRIGGER IF NOT EXISTS entry_search_ad AFTER DELETE ON ${SearchIndex.Documents} BEGIN
        INSERT INTO ${SearchIndex.Fts}(${SearchIndex.Fts}, rowid, label, body)
          VALUES('delete', old.docid, old.label, old.body);
      END;
      CREATE TRIGGER IF NOT EXISTS entry_search_au AFTER UPDATE ON ${SearchIndex.Documents} BEGIN
        INSERT INTO ${SearchIndex.Fts}(${SearchIndex.Fts}, rowid, label, body)
          VALUES('delete', old.docid, old.label, old.body);
        INSERT INTO ${SearchIndex.Fts}(rowid, label, body) VALUES (new.docid, new.label, new.body);
      END;
    `);

    db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`).run(
      SearchIndex.StampKey,
      want
    );

    // A fresh install is also "stale": the table exists and is empty while
    // entries do not, so the caller has to fill it either way.
    return stale;
  }

  /**
   * What a *disabled* open does — and pointedly not `drop`.
   *
   * Opening is not a destructive act: every CLI subcommand opens the store, so
   * one `silo keys list` from a build without FTS5, or with search switched
   * off in its config, would otherwise delete the index a running server is
   * maintaining on the same data dir. Clearing the stamp is enough: while
   * search is off the tables are never read, and re-enabling finds no stamp,
   * so `install` drops and rebuilds rather than trusting rows that went stale
   * while nothing was maintaining them.
   */
  static disable(db: Database): void {
    db.prepare(`DELETE FROM meta WHERE key = ?`).run(SearchIndex.StampKey);
  }

  static drop(db: Database): void {
    db.exec(`
      DROP TRIGGER IF EXISTS entry_search_ai;
      DROP TRIGGER IF EXISTS entry_search_ad;
      DROP TRIGGER IF EXISTS entry_search_au;
      DROP TABLE IF EXISTS ${SearchIndex.Fts};
      DROP TABLE IF EXISTS ${SearchIndex.Documents};
    `);
    db.prepare(`DELETE FROM meta WHERE key = ?`).run(SearchIndex.StampKey);
  }

  /** True when the index holds nothing but entries exist — a rebuild is due. */
  static isEmptyWithContent(db: Database): boolean {
    const docs = db.prepare(`SELECT COUNT(*) AS n FROM ${SearchIndex.Documents}`).get() as {
      n: number;
    };
    if (docs.n > 0) return false;
    const entries = db
      .prepare(
        `SELECT COUNT(*) AS n FROM entries e JOIN projects p ON p.id = e.project_id
         WHERE SUBSTR(p.name, 1, 1) != '_'`
      )
      .get() as { n: number };
    return entries.n > 0;
  }
}
