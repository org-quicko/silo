import { EntryUtils } from "../domain/entry-utils";
import type { Entry } from "../domain/entry";
import { Scope } from "../domain/scope";
import type { Storage } from "../ports/storage";
import { EntryNodes } from "../query/entry-nodes";
import { CollectionSchemas } from "../schema/collection-schemas";
import { JsonPath } from "@silo/shared/json-path";
import type { SearchAccess } from "./search-access";
import type { SearchHit } from "./search-hit";
import type { SearchRequest } from "./search-request";
import type { SearchResult } from "./search-result";
import type { SearchTarget } from "./search-target";
import { SearchSnippets } from "./search-snippets";
import { SearchText } from "./search-text";
import { SearchTokens, type SearchQuery } from "./search-tokens";
import type { Searcher } from "./searcher";

interface ResolvedTarget {
  scope: Scope;
  collection: string;
  schema: any;
}

/**
 * Search by reading entries and matching in memory — the portable engine
 * (D30).
 *
 * It ships before FTS5 and works on every adapter, present and future, which
 * is the whole point: search then exists everywhere on day one, and a native
 * engine makes it *fast* rather than making it *possible*. It is also the
 * fallback when a SQLite build turns out to lack FTS5, which cannot be
 * repaired at runtime because the shipped build sets `OMIT_LOAD_EXTENSION`.
 *
 * The cost is honest and bounded: this is O(N) over everything the caller may
 * read, so it stops at a visit cap **and** a time budget and says so with
 * `truncated`. A count cap alone is not enough — one collection of very large
 * documents can exhaust a request's patience well before its entry count.
 */
export class ScanSearcher implements Searcher {
  /** How many entries one search may examine before it gives up. */
  static readonly DefaultVisitLimit = 20_000;
  /** ...and how long, whichever comes first. */
  static readonly DefaultTimeBudgetMs = 3_000;
  private static readonly PageSize = 200;

  private readonly store: Storage;
  private readonly visitLimit: number;
  private readonly timeBudgetMs: number;

  constructor(
    store: Storage,
    options: { visitLimit?: number; timeBudgetMs?: number } = {}
  ) {
    this.store = store;
    this.visitLimit = options.visitLimit ?? ScanSearcher.DefaultVisitLimit;
    this.timeBudgetMs = options.timeBudgetMs ?? ScanSearcher.DefaultTimeBudgetMs;
  }

  capabilities(): { engine: "fts5" | "scan"; snippets: boolean } {
    return { engine: "scan", snippets: true };
  }

  /** Nothing is stored, so there is nothing to rebuild — or to check. */
  async reindex(): Promise<{ collections: number; entries: number }> {
    return { collections: 0, entries: 0 };
  }

  check(): null {
    return null;
  }

  async search(request: SearchRequest, access: SearchAccess): Promise<SearchResult> {
    const query = SearchTokens.parseQuery(request.q ?? "");
    const targets = await this.resolveTargets(request, access);

    const scored: { hit: SearchHit; score: number }[] = [];
    const deadline = Date.now() + this.timeBudgetMs;
    let visited = 0;
    let truncated = false;

    outer: for (const target of targets) {
      let offset = 0;
      while (true) {
        if (ScanSearcher.spent(visited, this.visitLimit, deadline)) {
          truncated = true;
          break outer;
        }

        const page = await this.store.list(target.scope, target.collection, {
          filter: request.filter,
          // Never fetch more than the budget can spend: with a small cap, a
          // full page would be read and then mostly thrown away.
          limit: Math.min(ScanSearcher.PageSize, this.visitLimit - visited),
          offset,
        });
        if (page.items.length === 0) break;

        for (const entry of page.items) {
          // Checked per entry, not per page. At page granularity a single
          // page could overrun the cap by its whole size, which is most of
          // what the cap exists to prevent.
          if (ScanSearcher.spent(visited, this.visitLimit, deadline)) {
            truncated = true;
            break outer;
          }
          visited++;
          const match = ScanSearcher.match(entry, target, query);
          if (match) scored.push(match);
        }

        offset += page.items.length;
        if (offset >= page.total) break;
      }
    }

    ScanSearcher.order(scored, request);

    const limit = request.limit;
    const offset = Math.max(0, request.offset);
    return {
      items: scored.slice(offset, offset + limit).map((s) => s.hit),
      total: scored.length,
      limit,
      offset,
      truncated,
      engine: "scan",
    };
  }

  /**
   * Which (scope, collection) pairs this request may read: what exists,
   * narrowed by the reach the route derived from the path, and intersected
   * with the access plan. A collection the plan does not cover is never
   * visited at all, so it cannot affect `total` or paging.
   */
  private async resolveTargets(
    request: SearchRequest,
    access: SearchAccess
  ): Promise<ResolvedTarget[]> {
    if (access.targets.length === 0) return [];

    const out: ResolvedTarget[] = [];
    for (const scope of await this.store.listScopes()) {
      if (request.project && scope.project !== request.project) continue;
      if (request.env && scope.env !== request.env) continue;

      // One read: since D51 every collection has a record, so there is no
      // collection holding searchable entries that this could miss.
      const schemas = CollectionSchemas.map(await this.store.listCollections(scope));
      const names = new Set<string>(schemas.keys());

      for (const name of [...names].sort()) {
        if (EntryUtils.isSystemCollection(name)) continue;
        if (request.collection && name !== request.collection) continue;
        if (!ScanSearcher.permits(access, scope, name)) continue;
        out.push({ scope, collection: name, schema: schemas.get(name) });
      }
    }
    return out;
  }

  /** Out of entries to visit, or out of time. */
  private static spent(visited: number, limit: number, deadline: number): boolean {
    return visited >= limit || Date.now() > deadline;
  }

  private static permits(access: SearchAccess, scope: Scope, collection: string): boolean {
    return access.targets.some(
      (t: SearchTarget) =>
        ScanSearcher.segment(t.project, scope.project) &&
        ScanSearcher.segment(t.env, scope.env) &&
        ScanSearcher.segment(t.collection, collection)
    );
  }

  private static segment(allowed: string, actual: string): boolean {
    return allowed === "*" || allowed === actual;
  }

  private static match(
    entry: Entry,
    target: ResolvedTarget,
    query: SearchQuery
  ): { hit: SearchHit; score: number } | null {
    const hit = (score: number, snippets: SearchHit["snippets"]) => ({
      hit: {
        project: target.scope.project,
        env: target.scope.env,
        collection: target.collection,
        entry,
        snippets,
      },
      score,
    });

    // A filter-only search is legitimate: the storage layer has already
    // applied the filter, so every entry that arrives here is a result.
    if (query.terms.length === 0) return hit(0, []);

    const text = SearchText.extract(entry.data, target.schema);
    const labelTokens = new Set(SearchTokens.tokenize(text.label));
    const bodyTokens = new Set(SearchTokens.tokenize(text.body));
    const all = new Set([...labelTokens, ...bodyTokens]);

    if (!SearchTokens.matchesAll(all, query)) return null;

    // Ten-to-one mirrors `bm25(fts, 10.0, 1.0)` on the SQLite side. The two
    // engines will still order differently — that is stated in D30 rather than
    // papered over — but a title match outranking a body match is the one
    // ordering property worth holding in common.
    const score =
      10 * SearchTokens.matchCount(labelTokens, query) +
      SearchTokens.matchCount(bodyTokens, query);

    return hit(score, SearchSnippets.build(text.fields, query));
  }

  /**
   * An explicit sort wins and relevance is ignored; otherwise a text query
   * orders by relevance and a filter-only query by `-$.updated_at`. Ties break
   * on id so paging is stable — without that, two entries of equal score can
   * swap places between page 1 and page 2 and a result is seen twice or not at
   * all.
   */
  private static order(scored: { hit: SearchHit; score: number }[], request: SearchRequest): void {
    const sort = request.sort && request.sort.length > 0 ? request.sort : null;

    if (!sort && (!request.q || request.q.trim() === "")) {
      scored.sort(
        (a, b) =>
          EntryNodes.compare(
            EntryNodes.sortValue(b.hit.entry, JsonPath.UpdatedAt),
            EntryNodes.sortValue(a.hit.entry, JsonPath.UpdatedAt)
          ) || a.hit.entry.id.localeCompare(b.hit.entry.id)
      );
      return;
    }

    if (!sort) {
      scored.sort((a, b) => b.score - a.score || a.hit.entry.id.localeCompare(b.hit.entry.id));
      return;
    }

    scored.sort((a, b) => {
      for (const key of sort) {
        const cmp = EntryNodes.compare(
          EntryNodes.sortValue(a.hit.entry, key.path),
          EntryNodes.sortValue(b.hit.entry, key.path)
        );
        if (cmp !== 0) return key.desc ? -cmp : cmp;
      }
      return a.hit.entry.id.localeCompare(b.hit.entry.id);
    });
  }
}
