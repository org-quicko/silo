import type { Database } from "bun:sqlite";
import type { MediaUsage } from "../../../core/media/media-usage";
import type { CollectionAddress } from "./sqlite-scope-resolver";

/**
 * The `media_references` table (D23).
 *
 * Writes are always called from inside a caller's transaction — an entry and
 * its references land together or not at all, which is the whole reason usages
 * sit on the `Storage` port rather than in a layer above it. A crash must never
 * leave a media file deletable while an entry still names it.
 *
 * Rows are keyed by record id since D51, with a cascading foreign key to the
 * entry, so no `purgeProject`/`purgeEnvironment` is needed: deleting the
 * entries takes their references along.
 */
export class SqliteMediaReferenceStore {
  /** Matches the default page size the media routes ask for. */
  private static readonly FallbackLimit = 50;

  /**
   * `MediaUsage` is public — the 409 body enumerates it — so the read side
   * joins back to the record tables for names. The join is also what keeps the
   * ordering on the names: sorting by ULID and mapping afterwards would move a
   * page boundary relative to what the caller sees.
   */
  private static readonly Joined = `FROM media_references r
    JOIN projects p ON p.id = r.project_id
    JOIN environments v ON v.id = r.env_id
    JOIN collections c ON c.id = r.collection_id`;

  private readonly database: Database;

  constructor(database: Database) {
    this.database = database;
  }

  /** Replaces every reference an entry makes. Transactional with the entry. */
  replaceForEntry(address: CollectionAddress, entryId: string, mediaIds: string[]): void {
    this.purgeEntry(address.collectionId, entryId);
    if (mediaIds.length === 0) return;

    const insert = this.database.prepare(
      `INSERT OR IGNORE INTO media_references
         (media_id, project_id, env_id, collection_id, entry_id)
       VALUES (?, ?, ?, ?, ?)`
    );
    for (const mediaId of mediaIds) {
      insert.run(mediaId, address.projectId, address.envId, address.collectionId, entryId);
    }
  }

  purgeEntry(collectionId: string, entryId: string): void {
    this.database
      .prepare(`DELETE FROM media_references WHERE collection_id = ? AND entry_id = ?`)
      .run(collectionId, entryId);
  }

  /** Media ids reach SQL as bound parameters, like every other value. */
  list(
    mediaIds: string[],
    page: { limit?: number; offset?: number } = {}
  ): { items: MediaUsage[]; total: number } {
    if (mediaIds.length === 0) return { items: [], total: 0 };

    const placeholders = mediaIds.map(() => "?").join(", ");
    const totalRow = this.database
      .prepare(`SELECT COUNT(*) as n FROM media_references WHERE media_id IN (${placeholders})`)
      .get(...mediaIds) as { n: number };

    const limit =
      page.limit === undefined
        ? SqliteMediaReferenceStore.FallbackLimit
        : Math.max(0, page.limit);
    const offset = Math.max(0, page.offset || 0);

    const items = this.database
      .prepare(
        `SELECT r.media_id AS media_id, p.name AS project, v.name AS env,
                c.name AS collection, r.entry_id AS entry_id
         ${SqliteMediaReferenceStore.Joined}
         WHERE r.media_id IN (${placeholders})
         ORDER BY p.name, v.name, c.name, r.entry_id
         LIMIT ? OFFSET ?`
      )
      .all(...mediaIds, limit, offset) as MediaUsage[];

    return { items, total: Number(totalRow.n) };
  }

  count(mediaIds: string[]): Map<string, number> {
    const counts = new Map<string, number>();
    if (mediaIds.length === 0) return counts;

    const placeholders = mediaIds.map(() => "?").join(", ");
    const rows = this.database
      .prepare(
        `SELECT media_id, COUNT(*) as n FROM media_references
         WHERE media_id IN (${placeholders})
         GROUP BY media_id`
      )
      .all(...mediaIds) as { media_id: string; n: number }[];

    for (const row of rows) counts.set(row.media_id, Number(row.n));
    return counts;
  }
}
