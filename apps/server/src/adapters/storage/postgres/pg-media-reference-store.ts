import { PortableData } from "../../../core/domain/portable-data";
import type { MediaUsage } from "../../../core/media/media-usage";
import type { PgCollectionAddress } from "./pg-collection-address";
import type { PgQueryable } from "./pg-queryable";
import type { PgTables } from "./pg-tables";

/**
 * The `media_references` table (D23), with the rules
 * `SqliteMediaReferenceStore` documents: written inside the entry's own
 * transaction, keyed by record id, and removed with the entry by the cascade.
 *
 * A list of media ids travels as one JSON array parameter, so a page of any
 * size is one fixed statement text.
 */
export class PgMediaReferenceStore {
  /** Matches the default page size the media routes ask for. */
  private static readonly FallbackLimit = 50;

  private readonly database: PgQueryable;
  private readonly tables: PgTables;

  constructor(database: PgQueryable, tables: PgTables) {
    this.database = database;
    this.tables = tables;
  }

  /** Replaces every reference an entry makes, inside the caller's transaction. */
  async replaceForEntry(
    transaction: PgQueryable,
    address: PgCollectionAddress,
    entryId: string,
    mediaIds: readonly string[]
  ): Promise<void> {
    await transaction.query(
      `DELETE FROM ${this.tables.mediaReferences} WHERE collection_id = $1 AND entry_id = $2`,
      [address.collectionId, entryId]
    );
    if (mediaIds.length === 0) return;

    await transaction.query(
      `INSERT INTO ${this.tables.mediaReferences}
         (media_id, project_id, env_id, collection_id, entry_id)
       SELECT media.id, $2, $3, $4, $5
       FROM jsonb_array_elements_text($1::text::jsonb) AS media (id)
       ON CONFLICT DO NOTHING`,
      [JSON.stringify(mediaIds), address.projectId, address.envId, address.collectionId, entryId]
    );
  }

  /**
   * A page of usages, named and ordered by scope names, for the reason
   * `SqliteMediaReferenceStore` gives for its join.
   */
  async list(
    mediaIds: readonly string[],
    page: { limit?: number; offset?: number } = {}
  ): Promise<{ items: MediaUsage[]; total: number }> {
    const ids = PgMediaReferenceStore.storable(mediaIds);
    if (ids.length === 0) return { items: [], total: 0 };

    const limit =
      page.limit === undefined
        ? PgMediaReferenceStore.FallbackLimit
        : PgMediaReferenceStore.whole(page.limit);
    const offset = PgMediaReferenceStore.whole(page.offset);
    const matching = `r.media_id = ANY(ARRAY(SELECT jsonb_array_elements_text($1::text::jsonb)))`;

    const [counted] = await this.database.query<{ total: string }>(
      `SELECT count(*) AS total FROM ${this.tables.mediaReferences} r WHERE ${matching}`,
      [JSON.stringify(ids)]
    );
    const items = await this.database.query<MediaUsage>(
      `SELECT r.media_id AS media_id, p.name AS project, v.name AS env,
              c.name AS collection, r.entry_id AS entry_id
       FROM ${this.tables.mediaReferences} r
         JOIN ${this.tables.projects} p ON p.id = r.project_id
         JOIN ${this.tables.environments} v ON v.id = r.env_id
         JOIN ${this.tables.collections} c ON c.id = r.collection_id
       WHERE ${matching}
       ORDER BY p.name, v.name, c.name, r.entry_id
       LIMIT ${limit} OFFSET ${offset}`,
      [JSON.stringify(ids)]
    );

    return { items: [...items], total: Number(counted.total) };
  }

  async count(mediaIds: readonly string[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    const ids = PgMediaReferenceStore.storable(mediaIds);
    if (ids.length === 0) return counts;

    const rows = await this.database.query<{ media_id: string; total: string }>(
      `SELECT media_id, count(*) AS total FROM ${this.tables.mediaReferences}
       WHERE media_id = ANY(ARRAY(SELECT jsonb_array_elements_text($1::text::jsonb)))
       GROUP BY media_id`,
      [JSON.stringify(ids)]
    );
    for (const row of rows) counts.set(row.media_id, Number(row.total));
    return counts;
  }

  /** A count written into the SQL, so it has to be a whole number. */
  private static whole(value: number | undefined): number {
    return value !== undefined && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  }

  /** An id no entry could have stored matches nothing, and jsonb would refuse it. */
  private static storable(mediaIds: readonly string[]): string[] {
    return mediaIds.filter((id) => typeof id === "string" && PortableData.problem(id) === null);
  }
}
