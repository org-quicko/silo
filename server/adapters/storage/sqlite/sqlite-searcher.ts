import { Database } from "bun:sqlite";
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

  private readonly db: Database;
  private readonly store: Storage;
  private readonly tokenizer: string;

  constructor(db: Database, store: Storage, tokenizer: string) {
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

    const join = `JOIN entries e ON e.project = d.project AND e.env = d.env
                  AND e.collection = d.collection AND e.id = d.entry_id`;
    const cond = where.join(" AND ");

    const totalRow = this.db
      .prepare(`SELECT COUNT(*) AS n ${from} ${join} WHERE ${cond}`)
      .get(...args) as { n: number };

    const order = this.order(request, text.match);
    const rows = this.db
      .prepare(
        `SELECT e.id, e.project, e.env, e.collection, e.rev, e.seq, e.created_at, e.updated_at, e.data
         ${from} ${join} WHERE ${cond} ORDER BY ${order.sql} LIMIT ? OFFSET ?`
      )
      .all(...args, ...order.args, limit, offset) as any[];

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

      const schemas = await this.store.listSchemas(scope);
      const names = new Set<string>(schemas.keys());
      for (const name of await this.store.listEntryCollections(scope)) names.add(name);

      for (const name of names) {
        if (EntryUtils.isSystemCollection(name)) continue;
        if (target && target.collection !== "*" && target.collection !== name) continue;
        collections++;
        this.clear({ project: scope.project, env: scope.env, collection: name });

        let offset = 0;
        while (true) {
          const page = await this.store.list(scope, name, { limit: 200, offset });
          if (page.items.length === 0) break;
          const schema = schemas.get(name);
          const insert = this.db.prepare(
            `INSERT INTO ${SearchIndex.Documents} (project, env, collection, entry_id, label, body)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT (project, env, collection, entry_id) DO UPDATE SET
               label = excluded.label, body = excluded.body`
          );
          const tx = this.db.transaction(() => {
            for (const e of page.items) {
              const text = SearchText.extract(e.data, schema);
              insert.run(scope.project, scope.env, name, e.id, text.label, text.body);
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
    } catch (err: any) {
      index = err.message || "failed";
    }

    const orphan = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM ${SearchIndex.Documents} d
         LEFT JOIN entries e ON e.project = d.project AND e.env = d.env
           AND e.collection = d.collection AND e.id = d.entry_id
         WHERE e.id IS NULL`
      )
      .get() as { n: number };

    const missing = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM entries e
         LEFT JOIN ${SearchIndex.Documents} d ON d.project = e.project AND d.env = e.env
           AND d.collection = e.collection AND d.entry_id = e.id
         WHERE d.docid IS NULL AND e.project != ? AND e.collection NOT LIKE '\\_%' ESCAPE '\\'`
      )
      .get(Scope.System.project) as { n: number };

    return { index, orphanDocuments: orphan.n, missingDocuments: missing.n };
  }

  private clear(target: SearchTarget): void {
    this.db
      .prepare(
        `DELETE FROM ${SearchIndex.Documents}
         WHERE project = ? AND env = ? AND collection = ?`
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
        ["d.project", t.project],
        ["d.env", t.env],
        ["d.collection", t.collection],
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
      cond.push("d.project = ?");
      args.push(request.project);
    }
    if (request.env) {
      cond.push("d.env = ?");
      args.push(request.env);
    }
    if (request.collection) {
      cond.push("d.collection = ?");
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
