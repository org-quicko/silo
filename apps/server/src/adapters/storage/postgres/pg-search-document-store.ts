import { EntryUtils } from "../../../core/domain/entry-utils";
import { Scope } from "../../../core/domain/scope";
import type { PgCollectionAddress } from "./pg-collection-address";
import type { PgQueryable } from "./pg-queryable";
import { PgSearchDocument } from "./pg-search-document";
import type { PgSearchTokenizer } from "./pg-search-tokenizer";
import type { PgTables } from "./pg-tables";

/**
 * The `entry_search` rows, written inside the entry's own transaction so an
 * entry and its index row land together or not at all (D30). Every method is a
 * no-op while the store keeps no index, so callers never have to ask.
 *
 * The tokenizer is the index's, not this process's config: a command beside a
 * running server writes rows in the form the server reads (D103).
 */
export class PgSearchDocumentStore {
  private readonly tables: PgTables;
  private tokenizer: PgSearchTokenizer | null = null;

  constructor(tables: PgTables) {
    this.tables = tables;
  }

  /** The form rows are written in from now on, or null to write none. */
  use(tokenizer: PgSearchTokenizer | null): void {
    this.tokenizer = tokenizer;
  }

  /**
   * Inserts or replaces one entry's row, or removes it when `text` is null.
   *
   * System data is refused here as well as by the caller, for the reason
   * `SqliteSearchDocumentStore.write` gives: one forgotten `null` must not make
   * a key's label findable by text.
   */
  async write(
    transaction: PgQueryable,
    address: PgCollectionAddress,
    entryId: string,
    text: { label: string; body: string } | null
  ): Promise<void> {
    const tokenizer = this.tokenizer;
    if (tokenizer === null) return;
    if (
      text === null ||
      address.project === Scope.System.project ||
      EntryUtils.isSystemCollection(address.collection)
    ) {
      await transaction.query(
        `DELETE FROM ${this.tables.searchDocuments} WHERE collection_id = $1 AND entry_id = $2`,
        [address.collectionId, entryId]
      );
      return;
    }

    const row = PgSearchDocument.of(text, tokenizer);
    await transaction.query(
      `INSERT INTO ${this.tables.searchDocuments}
         (project_id, env_id, collection_id, entry_id, document, label, body)
       VALUES ($1, $2, $3, $4, $5::tsvector, $6, $7)
       ON CONFLICT (collection_id, entry_id) DO UPDATE SET
         document = excluded.document,
         label = excluded.label,
         body = excluded.body`,
      [
        address.projectId,
        address.envId,
        address.collectionId,
        entryId,
        row.document,
        row.label,
        row.body,
      ]
    );
  }
}
