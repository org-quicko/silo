import type { SqliteConnection } from "./sqlite-connection";
import { EntryUtils } from "../../../core/domain/entry-utils";
import type { Entry } from "../../../core/domain/entry";
import { Scope } from "../../../core/domain/scope";
import type { Storage } from "../../../core/ports/storage";
import type { SearchAccess } from "../../../core/search/search-access";
import type { SearchHit } from "../../../core/search/search-hit";
import type { SearchIntegrity } from "../../../core/search/search-integrity";
import type { SearchRequest } from "../../../core/search/search-request";
import type { SearchResult } from "../../../core/search/search-result";
import type { SearchTarget } from "../../../core/search/search-target";
import type { Searcher } from "../../../core/search/searcher";
import { SearchSnippets } from "../../../core/search/search-snippets";
import { SearchText } from "../../../core/search/search-text";
import { SearchTokens, type SearchQuery } from "../../../core/search/search-tokens";
import { SqliteCompiler } from "./sqlite-compiler";
import { SearchIndex } from "./search-index";

/**
 * The FTS5 engine (D30). It matches and **ranks** in SQL — that is what an
 * index buys — and then builds snippets the same way `ScanSearcher` does, from
 * the entry rows it has already joined.
 *
 * Reusing the shared snippet builder rather than FTS5's `snippet()` is
 * deliberate. Only two concatenated columns are indexed, so `snippet()` could
 * say *that* a body matched but never *which field* did; re-extracting over
 * one page of results costs almost nothing and removes an engine difference
 * instead of adding one.
 */
export class SqliteSearcher implements Searcher {
  /** Trigram cannot match a term shorter than this; unicode61 has no floor. */
  private static readonly TrigramMinTerm = 3;

  /**
   * The entry behind each document, and the three record rows that carry its
   * scope's **names** (D51).
   *
   * The name joins are not decoration. A claim's scope segments are names with
   * independent wildcards, so resolving a plan to ids up front would mean
   * expanding every `*` into the set of ids it currently covers — a set that
   * changes under the query. Joining instead lets `accessPredicate` stay what
   * it was, a name comparison in the same statement as the match, which is what
   * keeps `total` and every page boundary honest.
   *
   * Each record table is joined through a subquery that **renames its
   * columns**. All three carry `id`, `name`, `created_at` and `updated_at`, and
   * `SqliteCompiler` emits envelope columns unqualified — shared with
   * `SqliteEntryStore.list`, which joins nothing — so a plain join makes every
   * `ORDER BY id` and every `created_at` filter ambiguous. Renaming here keeps
   * the compiler's output valid in both callers rather than teaching it an
   * alias it only ever needs in one.
   */
  private static readonly Joins = `JOIN entries e
      ON e.collection_id = d.collection_id AND e.id = d.entry_id
    JOIN (SELECT id AS project_key, name AS project_name FROM projects) p
      ON p.project_key = d.project_id
    JOIN (SELECT id AS env_key, name AS env_name FROM environments) v
      ON v.env_key = d.env_id
    JOIN (SELECT id AS collection_key, name AS collection_name FROM collections) c
      ON c.collection_key = d.collection_id`;

  private readonly db: SqliteConnection;
  private readonly store: Storage;
  private readonly tokenizer: string;

  constructor(db: SqliteConnection, store: Storage, tokenizer: string) {
    this.db = db;
    this.store = store;
    this.tokenizer = tokenizer;
  }

  capabilities(): { engine: "fts5" | "scan"; snippets: boolean } {
    return { engine: "fts5", snippets: true };
  }

  async search(request: SearchRequest, access: SearchAccess): Promise<SearchResult> {
    const limit = request.limit;
    const offset = Math.max(0, request.offset);
    const empty: SearchResult = {
      items: [],
      total: 0,
      limit,
      offset,
      truncated: false,
      engine: "fts5",
    };

    const where: string[] = [];
    const args: any[] = [];

    const scope = SqliteSearcher.accessPredicate(access, request);
    if (!scope) return empty;
    where.push(scope.cond);
    args.push(...scope.args);

    const query = SearchTokens.parseQuery(request.q ?? "");
    const text = this.textPredicate(query);
    // A term the tokenizer cannot represent at all (a one-character trigram
    // search) matches nothing — saying so beats scanning every row to prove it.
    if (text === null) return empty;
    const from = text.match
      ? `FROM ${SearchIndex.Fts}
         JOIN ${SearchIndex.Documents} d ON d.docid = ${SearchIndex.Fts}.rowid`
      : `FROM ${SearchIndex.Documents} d`;
    where.push(...text.conds);
    args.push(...text.args);

    if (request.filter) {
      const compiled = SqliteCompiler.buildFilter(request.filter);
      where.push("(" + compiled.cond + ")");
      args.push(...compiled.args);
    }

    const cond = where.join(" AND ");

    const totalRow = this.db.once(`SELECT COUNT(*) AS n ${from} ${SqliteSearcher.Joins} WHERE ${cond}`,
      (statement) => statement.get(...args)
    ) as { n: number };

    const order = this.order(request, text.match);
    const rows = this.db.once(`SELECT e.id, p.project_name AS project, v.env_name AS env, c.collection_name AS collection,
                e.rev, e.seq, e.created_at, e.updated_at, e.data
         ${from} ${SqliteSearcher.Joins} WHERE ${cond} ORDER BY ${order.sql} LIMIT ? OFFSET ?`,
      (statement) => statement.all(...args, ...order.args, limit, offset)
    ) as any[];

    return {
      items: await this.toHits(rows, query),
      total: totalRow.n,
      limit,
      offset,
      // An index answers completely or not at all; only a scan runs out of
      // budget, so this is never true here.
      truncated: false,
      engine: "fts5",
    };
  }

  /**
   * Refills the index from the entries themselves, through the same extractor
   * a write would have used — one definition of "the searchable text of an
   * entry", not two.
   */
  async reindex(target?: SearchTarget): Promise<{ collections: number; entries: number }> {
    let collections = 0;
    let entries = 0;

    for (const scope of await this.store.listScopes()) {
      if (target && target.project !== "*" && target.project !== scope.project) continue;
      if (target && target.env !== "*" && target.env !== scope.env) continue;

      // One read, not a union with `listEntryCollections`: since D51 every
      // collection has a record, so there is no collection holding entries that
      // this could miss.
      for (const record of await this.store.listCollections(scope)) {
        const name = record.name;
        if (EntryUtils.isSystemCollection(name)) continue;
        if (target && target.collection !== "*" && target.collection !== name) continue;
        collections++;
        this.clear({ project: scope.project, env: scope.env, collection: name });

        let offset = 0;
        while (true) {
          const page = await this.store.list(scope, name, { limit: 200, offset });
          if (page.items.length === 0) break;
          const insert = this.db.query(
            `INSERT INTO ${SearchIndex.Documents}
               (project_id, env_id, collection_id, entry_id, label, body)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT (collection_id, entry_id) DO UPDATE SET
               label = excluded.label, body = excluded.body`
          );
          const tx = this.db.transaction(() => {
            for (const entry of page.items) {
              const text = SearchText.extract(entry.data, record.schema);
              insert.run(
                record.project_id,
                record.env_id,
                record.id,
                entry.id,
                text.label,
                text.body
              );
              entries++;
            }
          });
          tx();
          offset += page.items.length;
          if (offset >= page.total) break;
        }
      }
    }
    return { collections, entries };
  }

  /**
   * Both integrity checks (D30). FTS5's built-in one compares the index
   * against the document table and stops there, so a document row whose entry
   * has vanished — or an entry with no document row — is invisible to it and
   * needs the second, hand-written anti-join.
   */
  check(): SearchIntegrity {
    let index = "ok";
    try {
      this.db.exec(`INSERT INTO ${SearchIndex.Fts}(${SearchIndex.Fts}) VALUES('integrity-check')`);
    } catch (caught: any) {
      index = caught.message || "failed";
    }

    const orphan = this.db
      .query(
        `SELECT COUNT(*) AS n FROM ${SearchIndex.Documents} d
         LEFT JOIN entries e
           ON e.collection_id = d.collection_id AND e.id = d.entry_id
         WHERE e.id IS NULL`
      )
      .get() as { n: number };

    const missing = this.db
      .query(
        `SELECT COUNT(*) AS n FROM entries e
         JOIN projects p ON p.id = e.project_id
         JOIN collections c ON c.id = e.collection_id
         LEFT JOIN ${SearchIndex.Documents} d
           ON d.collection_id = e.collection_id AND d.entry_id = e.id
         WHERE d.docid IS NULL
           AND SUBSTR(p.name, 1, 1) != '_'
           AND SUBSTR(c.name, 1, 1) != '_'`
      )
      .get() as { n: number };

    return { index, orphanDocuments: orphan.n, missingDocuments: missing.n };
  }

  /** By name, resolved inside the statement: the caller iterates names and the
   *  documents table holds ids. */
  private clear(target: SearchTarget): void {
    this.db
      .query(
        `DELETE FROM ${SearchIndex.Documents} WHERE collection_id IN (
           SELECT c.id FROM collections c
             JOIN environments v ON v.id = c.env_id
             JOIN projects p ON p.id = v.project_id
           WHERE p.name = ? AND v.name = ? AND c.name = ?
         )`
      )
      .run(target.project, target.env, target.collection);
  }

  /**
   * The claim plan as SQL, applied in the same statement as the match so that
   * `total` and every page boundary respect it. Post-filtering would leave
   * both wrong.
   */
  private static accessPredicate(
    access: SearchAccess,
    request: SearchRequest
  ): { cond: string; args: any[] } | null {
    if (access.targets.length === 0) return null;

    const groups: string[] = [];
    const args: any[] = [];
    for (const t of access.targets) {
      const parts: string[] = [];
      for (const [column, value] of [
        ["p.project_name", t.project],
        ["v.env_name", t.env],
        ["c.collection_name", t.collection],
      ] as [string, string][]) {
        if (value === "*") continue;
        parts.push(`${column} = ?`);
        args.push(value);
      }
      groups.push(parts.length === 0 ? "1" : "(" + parts.join(" AND ") + ")");
    }

    const cond = ["(" + groups.join(" OR ") + ")"];
    // The reach the route took from its path. Redundant with a narrowed plan,
    // but not with a `*` one, and cheap either way.
    if (request.project) {
      cond.push("p.project_name = ?");
      args.push(request.project);
    }
    if (request.env) {
      cond.push("v.env_name = ?");
      args.push(request.env);
    }
    if (request.collection) {
      cond.push("c.collection_name = ?");
      args.push(request.collection);
    }
    return { cond: cond.join(" AND "), args };
  }

  /**
   * The user's text as a MATCH expression, plus any terms the tokenizer cannot
   * index. Under `trigram` a term shorter than three characters has no entry
   * in the index at all, so it falls back to a substring test against the
   * stored document — exact, unindexed, and still correct.
   */
  private textPredicate(
    query: SearchQuery
  ): { match: boolean; conds: string[]; args: any[] } | null {
    if (query.terms.length === 0) return { match: false, conds: [], args: [] };

    const trigram = this.tokenizer.startsWith("trigram");
    const indexed: string[] = [];
    const conds: string[] = [];
    const args: any[] = [];

    for (let i = 0; i < query.terms.length; i++) {
      const term = query.terms[i];
      const isLast = i === query.terms.length - 1;
      if (trigram && term.length < SqliteSearcher.TrigramMinTerm) {
        conds.push(`(instr(lower(d.label), ?) > 0 OR instr(lower(d.body), ?) > 0)`);
        args.push(term, term);
        continue;
      }
      // Quote every term: FTS5 would otherwise read `AND`, `OR`, `NOT` and `*`
      // as query syntax, and a user typing "NOT" would get a syntax error
      // rather than a search.
      const quoted = '"' + term.replace(/"/g, '""') + '"';
      indexed.push(query.prefixLast && isLast ? quoted + "*" : quoted);
    }

    if (indexed.length > 0) {
      // Placed first so the MATCH argument binds before the rest.
      conds.unshift(`${SearchIndex.Fts} MATCH ?`);
      args.unshift(indexed.join(" "));
      return { match: true, conds, args };
    }
    return { match: false, conds, args };
  }

  private order(request: SearchRequest, ranked: boolean): { sql: string; args: any[] } {
    if (request.sort && request.sort.length > 0) {
      const built = SqliteCompiler.buildOrder(request.sort);
      return { sql: built.order, args: built.args };
    }
    if (ranked) {
      // bm25 is more negative the better the match, so ascending is best-first.
      // 10:1 weights the label column, mirroring `ScanSearcher`'s scoring.
      return { sql: `bm25(${SearchIndex.Fts}, 10.0, 1.0), e.id ASC`, args: [] };
    }
    return { sql: "e.updated_at DESC, e.id ASC", args: [] };
  }

  private async toHits(rows: any[], query: SearchQuery): Promise<SearchHit[]> {
    const schemas = new Map<string, any>();
    const hits: SearchHit[] = [];

    for (const row of rows) {
      const key = `${row.project}/${row.env}/${row.collection}`;
      if (!schemas.has(key)) {
        let schema: any;
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
        rev: row.rev,
        seq: row.seq,
        created_at: new Date(row.created_at),
        updated_at: new Date(row.updated_at),
        data: JSON.parse(row.data),
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
