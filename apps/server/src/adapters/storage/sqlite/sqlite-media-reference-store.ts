import type { Database } from "bun:sqlite";
import type { Entry } from "../../../core/domain/entry";
import type { MediaUsage } from "../../../core/media/media-usage";

/**
 * The `media_references` table (D23).
 *
 * Writes are always called from inside a caller's transaction — an entry and
 * its references land together or not at all, which is the whole reason usages
 * sit on the `Storage` port rather than in a layer above it. A crash must never
 * leave a media file deletable while an entry still names it.
 */
export class SqliteMediaReferenceStore {
  /** Matches the default page size the media routes ask for. */
  private static readonly FallbackLimit = 50;

  private readonly database: Database;

  constructor(database: Database) {
    this.database = database;
  }

  /** Replaces every reference an entry makes. Transactional with the entry. */
  replaceForEntry(entry: Entry, mediaIds: string[]): void {
    this.purgeEntry(entry.project, entry.env, entry.collection, entry.id);
    if (mediaIds.length === 0) return;

    const insert = this.database.prepare(
      `INSERT OR IGNORE INTO media_references (media_id, project, env, collection, entry_id)
       VALUES (?, ?, ?, ?, ?)`
    );
    for (const mediaId of mediaIds) {
      insert.run(mediaId, entry.project, entry.env, entry.collection, entry.id);
    }
  }

  purgeEntry(project: string, env: string, collection: string, entryId: string): void {
    this.database
      .prepare(
        `DELETE FROM media_references WHERE project = ? AND env = ? AND collection = ? AND entry_id = ?`
      )
      .run(project, env, collection, entryId);
  }

  purgeProject(project: string): void {
    this.database.prepare(`DELETE FROM media_references WHERE project = ?`).run(project);
  }

  purgeEnvironment(project: string, env: string): void {
    this.database
      .prepare(`DELETE FROM media_references WHERE project = ? AND env = ?`)
      .run(project, env);
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
        `SELECT media_id, project, env, collection, entry_id
         FROM media_references
         WHERE media_id IN (${placeholders})
         ORDER BY project, env, collection, entry_id
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
