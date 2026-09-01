import type { Database } from "bun:sqlite";
import { EntryUtils } from "../../../core/domain/entry-utils";
import { Scope } from "../../../core/domain/scope";
import { SearchIndex } from "./search-index";
import type { CollectionAddress } from "./sqlite-scope-resolver";

/**
 * The FTS5 document table (D30).
 *
 * Every method is a no-op when indexing is off — search is switched off, or
 * this SQLite build has no FTS5 — so callers never have to ask.
 *
 * Rows are keyed by record id since D51, with a cascading foreign key to the
 * entry, so deleting an entry, a collection's entries or a whole project takes
 * the index rows with it and fires the `AFTER DELETE` trigger that keeps FTS5
 * in step. There is no `purgeProject`/`purgeEnvironment` any more for that
 * reason.
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
    address: CollectionAddress,
    entryId: string,
    text: { label: string; body: string } | null
  ): void {
    if (!this.indexing) return;

    // Belt and braces on a security boundary: the caller passes null for
    // system data, and this refuses it independently. One forgotten argument
    // must not make a `_keys` label findable by text. Read off the address's
    // names rather than its ids, since `_`-prefixing is a fact about names.
    if (
      text === null ||
      address.project === Scope.System.project ||
      EntryUtils.isSystemCollection(address.collection)
    ) {
      this.purgeEntry(address, entryId);
      return;
    }

    this.database
      .prepare(
        `INSERT INTO ${SearchIndex.Documents}
           (project_id, env_id, collection_id, entry_id, label, body)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (collection_id, entry_id) DO UPDATE SET
           label = excluded.label,
           body  = excluded.body`
      )
      .run(
        address.projectId,
        address.envId,
        address.collectionId,
        entryId,
        text.label,
        text.body
      );
  }

  purgeEntry(address: CollectionAddress, entryId: string): void {
    if (!this.indexing) return;
    this.database
      .prepare(
        `DELETE FROM ${SearchIndex.Documents} WHERE collection_id = ? AND entry_id = ?`
      )
      .run(address.collectionId, entryId);
  }
}
