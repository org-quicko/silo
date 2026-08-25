import type { Database } from "bun:sqlite";
import { EntryUtils } from "../../../core/domain/entry-utils";
import { Scope } from "../../../core/domain/scope";
import { SearchIndex } from "./search-index";

/**
 * The FTS5 document table (D30).
 *
 * Every method is a no-op when indexing is off — search is switched off, or
 * this SQLite build has no FTS5 — so callers never have to ask.
 */
export class SqliteSearchDocumentStore {
  private readonly database: Database;
  private readonly indexing: boolean;

  constructor(database: Database, indexing: boolean) {
    this.database = database;
    this.indexing = indexing;
  }

  /**
   * Inserts or replaces one document, or removes it when `text` is null.
   * Always called from inside a caller's transaction, so an entry and its
   * index row land together or not at all.
   *
   * `ON CONFLICT DO UPDATE` rather than delete-then-insert, so `docid`
   * survives an update: `VACUUM` renumbers an implicit rowid, and re-inserting
   * would renumber it on every write — exactly the drift the explicit
   * `INTEGER PRIMARY KEY` exists to prevent.
   */
  write(
    project: string,
    env: string,
    collection: string,
    entryId: string,
    text: { label: string; body: string } | null
  ): void {
    if (!this.indexing) return;

    // Belt and braces on a security boundary: the caller passes null for
    // system data, and this refuses it independently. One forgotten argument
    // must not make a `_keys` label findable by text.
    if (
      text === null ||
      project === Scope.System.project ||
      EntryUtils.isSystemCollection(collection)
    ) {
      this.purgeEntry(project, env, collection, entryId);
      return;
    }

    this.database
      .prepare(
        `INSERT INTO ${SearchIndex.Documents} (project, env, collection, entry_id, label, body)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (project, env, collection, entry_id) DO UPDATE SET
           label = excluded.label,
           body  = excluded.body`
      )
      .run(project, env, collection, entryId, text.label, text.body);
  }

  purgeEntry(project: string, env: string, collection: string, entryId: string): void {
    if (!this.indexing) return;
    this.database
      .prepare(
        `DELETE FROM ${SearchIndex.Documents}
         WHERE project = ? AND env = ? AND collection = ? AND entry_id = ?`
      )
      .run(project, env, collection, entryId);
  }

  purgeProject(project: string): void {
    if (!this.indexing) return;
    this.database
      .prepare(`DELETE FROM ${SearchIndex.Documents} WHERE project = ?`)
      .run(project);
  }

  purgeEnvironment(project: string, env: string): void {
    if (!this.indexing) return;
    this.database
      .prepare(`DELETE FROM ${SearchIndex.Documents} WHERE project = ? AND env = ?`)
      .run(project, env);
  }
}
