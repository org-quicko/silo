import { ClaimSegment } from "@silo/shared/claim-segment";
import type { Entry } from "../../../core/domain/entry";
import { EntryUtils } from "../../../core/domain/entry-utils";
import { Scope } from "../../../core/domain/scope";
import type { Storage } from "../../../core/ports/storage";
import type { SearchAccess } from "../../../core/search/search-access";
import type { SearchEngine } from "../../../core/search/search-engine";
import type { SearchHit } from "../../../core/search/search-hit";
import type { SearchIntegrity } from "../../../core/search/search-integrity";
import type { SearchRequest } from "../../../core/search/search-request";
import type { SearchResult } from "../../../core/search/search-result";
import { SearchSnippets } from "../../../core/search/search-snippets";
import type { SearchTarget } from "../../../core/search/search-target";
import { SearchText } from "../../../core/search/search-text";
import { SearchTokens, type SearchQuery } from "../../../core/search/search-tokens";
import type { Searcher } from "../../../core/search/searcher";
import { PgCompiler } from "./pg-compiler";
import type { PgConnection } from "./pg-connection";
import { PgParams } from "./pg-params";
import type { PgScanGate } from "./pg-scan-gate";
import { PgSearchDocument } from "./pg-search-document";
import { PgSearchText } from "./pg-search-text";
import type { PgSearchTokenizer } from "./pg-search-tokenizer";
import type { PgTables } from "./pg-tables";

/**
 * The Postgres engine (D30), shaped like `SqliteSearcher`: it matches and
 * ranks in SQL, applies the access plan in the same statement so `total` and
 * every page boundary respect it, and builds snippets with the shared
 * `SearchSnippets` from the entries it has already read.
 *
 * Its ranks are not FTS5's scores. What the engines share is what a result
 * set contains and that a label match ranks above a body match; the order
 * within that is each engine's own (docs/design/storage.md §6.6).
 */
export class PgSearcher implements Searcher {
  private static readonly ReindexPage = 200;

  private readonly connection: PgConnection;
  private readonly tables: PgTables;
  private readonly store: Storage;
  private readonly tokenizer: PgSearchTokenizer;
  /** A search is a scan like a filtered list, and shares its slots. */
  private readonly scans: PgScanGate;

  constructor(
    connection: PgConnection,
    tables: PgTables,
    store: Storage,
    tokenizer: PgSearchTokenizer,
    scans: PgScanGate
  ) {
    this.connection = connection;
    this.tables = tables;
    this.store = store;
    this.tokenizer = tokenizer;
    this.scans = scans;
  }

  capabilities(): { engine: SearchEngine; snippets: boolean } {
    return { engine: "postgres", snippets: true };
  }

  async search(request: SearchRequest, access: SearchAccess): Promise<SearchResult> {
    const limit = Math.max(0, Math.floor(request.limit) || 0);
    const offset = Math.max(0, Math.floor(request.offset) || 0);
    const empty: SearchResult = { items: [], total: 0, limit, offset, truncated: false, engine: "postgres" };

    const params = new PgParams();
    const scope = PgSearcher.accessPredicate(access, request, params);
    if (scope === null) return empty;

    const query = SearchTokens.parseQuery(request.q ?? "");
    const text = PgSearchText.predicate(query, this.tokenizer, params);
    if (text === null) return empty;

    const where = [scope, ...text.conds];
    if (request.filter) where.push(`(${PgCompiler.buildFilter(request.filter, params)})`);
    const cond = where.join(" AND ");
    const order = this.order(request, text.rank, params);
    const from = this.from();

    return this.scans.run(async () => {
      const rows = await this.connection.query(
        `SELECT (SELECT count(*) ${from} WHERE ${cond}) AS total,
                e.id, p.project_name AS project, v.env_name AS env, c.collection_name AS collection,
                e.rev, e.seq, e.created_at, e.updated_at, e.data
         ${from}
         WHERE ${cond}
         ORDER BY ${order}
         LIMIT ${limit} OFFSET ${offset}`,
        params.values
      );

      let total = rows.length > 0 ? Number(rows[0].total) : 0;
      if (rows.length === 0 && offset > 0) {
        const [counted] = await this.connection.query<{ total: string }>(
          `SELECT count(*) AS total ${from} WHERE ${cond}`,
          params.values
        );
        total = Number(counted.total);
      }

      return {
        items: await this.toHits(rows, query),
        total,
        limit,
        offset,
        // An index answers completely or not at all; only a scan runs out of budget.
        truncated: false,
        engine: "postgres",
      };
    });
  }

  /**
   * Refills the index from the entries, through the same extractor a write
   * uses. One statement per page of 200, from one JSON parameter, checked
   * against `entries` so a row deleted since the page was read is skipped
   * rather than failing the batch on its foreign key.
   */
  async reindex(target?: SearchTarget): Promise<{ collections: number; entries: number }> {
    let collections = 0;
    let entries = 0;

    for (const scope of await this.store.listScopes()) {
      if (target && target.project !== "*" && target.project !== scope.project) continue;
      if (target && target.env !== "*" && target.env !== scope.env) continue;

      for (const record of await this.store.listCollections(scope)) {
        if (EntryUtils.isSystemCollection(record.name)) continue;
        if (target && target.collection !== "*" && target.collection !== record.name) continue;
        collections += 1;
        await this.connection.transaction((session) =>
          session.query(`DELETE FROM ${this.tables.searchDocuments} WHERE collection_id = $1`, [
            record.id,
          ])
        );

        for (let offset = 0; ; ) {
          const page = await this.store.list(scope, record.name, {
            limit: PgSearcher.ReindexPage,
            offset,
          });
          if (page.items.length === 0) break;

          const rows = page.items.map((entry) => ({
            entry_id: entry.id,
            ...PgSearchDocument.of(SearchText.extract(entry.data, record.schema), this.tokenizer),
          }));
          await this.connection.transaction((session) =>
            session.query(
              `INSERT INTO ${this.tables.searchDocuments}
                 (project_id, env_id, collection_id, entry_id, document, label, body)
               SELECT $1, $2, $3, r.entry_id, r.document::tsvector, r.label, r.body
               FROM jsonb_to_recordset($4::text::jsonb)
                 AS r (entry_id text, document text, label text, body text)
               WHERE EXISTS (
                 SELECT 1 FROM ${this.tables.entries} e
                 WHERE e.collection_id = $3 AND e.id = r.entry_id
               )
               ON CONFLICT (collection_id, entry_id) DO UPDATE SET
                 document = excluded.document, label = excluded.label, body = excluded.body`,
              [record.project_id, record.env_id, record.id, JSON.stringify(rows)]
            )
          );
          entries += page.items.length;
          offset += page.items.length;
          if (offset >= page.total) break;
        }
      }
    }
    return { collections, entries };
  }

  /**
   * Postgres keeps no index to check against the table, as FTS5 does, so the
   * first check is that every row carries the text its tokenizer reads. The
   * other two are `SqliteSearcher`'s anti-joins: an index row whose entry is
   * gone, and a user entry with no index row.
   */
  async check(): Promise<SearchIntegrity> {
    const blank =
      this.tokenizer === "trigram" ? "d.label IS NULL OR d.body IS NULL" : "d.document IS NULL";
    const [row] = await this.connection.query<{ blank: string; orphan: string; missing: string }>(
      `SELECT
         (SELECT count(*) FROM ${this.tables.searchDocuments} d WHERE ${blank}) AS blank,
         (SELECT count(*) FROM ${this.tables.searchDocuments} d
            LEFT JOIN ${this.tables.entries} e ON e.collection_id = d.collection_id AND e.id = d.entry_id
          WHERE e.id IS NULL) AS orphan,
         (SELECT count(*) FROM ${this.tables.entries} e
            JOIN ${this.tables.projects} p ON p.id = e.project_id
            JOIN ${this.tables.collections} c ON c.id = e.collection_id
            LEFT JOIN ${this.tables.searchDocuments} d
              ON d.collection_id = e.collection_id AND d.entry_id = e.id
          WHERE d.entry_id IS NULL AND left(p.name, 1) <> '_' AND left(c.name, 1) <> '_') AS missing`
    );
    const blanks = Number(row.blank);
    return {
      index: blanks === 0 ? "ok" : `${blanks} index rows hold no ${this.tokenizer} text`,
      orphanDocuments: Number(row.orphan),
      missingDocuments: Number(row.missing),
    };
  }

  /**
   * The index row, its entry, and the three record rows that carry the scope's
   * **names**, each renamed so the compiler's unqualified `id` and `data`
   * name the entry — `SqliteSearcher.Joins` explains both choices.
   */
  private from(): string {
    const t = this.tables;
    return `FROM ${t.searchDocuments} d
      JOIN ${t.entries} e ON e.collection_id = d.collection_id AND e.id = d.entry_id
      JOIN (SELECT id AS project_key, name AS project_name FROM ${t.projects}) p
        ON p.project_key = d.project_id
      JOIN (SELECT id AS env_key, name AS env_name FROM ${t.environments}) v
        ON v.env_key = d.env_id
      JOIN (SELECT id AS collection_key, name AS collection_name FROM ${t.collections}) c
        ON c.collection_key = d.collection_id`;
  }

  /**
   * The claim plan as SQL, in the same statement as the match, or null when it
   * admits nothing. Each segment's test comes from `ClaimSegment`, so the index
   * cannot answer a matching question differently from `ParsedClaim`.
   */
  private static accessPredicate(
    access: SearchAccess,
    request: SearchRequest,
    params: PgParams
  ): string | null {
    if (access.targets.length === 0) return null;
    const bind = (value: string) => params.add(value);

    const groups = access.targets.map((target) => {
      const parts = [
        ClaimSegment.postgres("p.project_name", target.project, bind),
        ClaimSegment.postgres("v.env_name", target.env, bind),
        ClaimSegment.postgres("c.collection_name", target.collection, bind),
      ].filter((part): part is string => part !== null);
      return parts.length === 0 ? "true" : `(${parts.join(" AND ")})`;
    });

    // The reach the route took from its path, on top of the plan.
    const cond = [`(${groups.join(" OR ")})`];
    if (request.project) cond.push(`p.project_name = ${bind(request.project)}`);
    if (request.env) cond.push(`v.env_name = ${bind(request.env)}`);
    if (request.collection) cond.push(`c.collection_name = ${bind(request.collection)}`);
    return cond.join(" AND ");
  }

  /** An explicit sort wins; then relevance when there is text; then newest first. */
  private order(request: SearchRequest, rank: string | null, params: PgParams): string {
    if (request.sort && request.sort.length > 0) return PgCompiler.buildOrder(request.sort, params);
    if (rank) return `${rank} DESC, e.id`;
    return "e.updated_at DESC, e.id";
  }

  private async toHits(rows: any[], query: SearchQuery): Promise<SearchHit[]> {
    const schemas = new Map<string, unknown>();
    const hits: SearchHit[] = [];

    for (const row of rows) {
      const key = `${row.project}/${row.env}/${row.collection}`;
      if (!schemas.has(key)) {
        let schema: unknown;
        try {
          schema = await this.store.getSchema(Scope.of(row.project, row.env), row.collection);
        } catch {
          schema = undefined;
        }
        schemas.set(key, schema);
      }

      const entry: Entry = {
        id: row.id,
        project: row.project,
        env: row.env,
        collection: row.collection,
        rev: Number(row.rev),
        seq: Number(row.seq),
        created_at: new Date(row.created_at),
        updated_at: new Date(row.updated_at),
        data: row.data,
      };
      const extracted = SearchText.extract(entry.data, schemas.get(key));
      hits.push({
        project: row.project,
        env: row.env,
        collection: row.collection,
        entry,
        snippets: SearchSnippets.build(extracted.fields, query),
      });
    }
    return hits;
  }
}
