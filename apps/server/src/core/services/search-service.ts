import { Claims } from "@silo/shared/claims";
import { SchemaAccess } from "@silo/shared/schema-access";
import { EntryUtils } from "../domain/entry-utils";
import { QueryUtils } from "../query/query-utils";
import type { SearchAccess } from "../search/search-access";
import type { SearchIntegrity } from "../search/search-integrity";
import type { SearchRequest } from "../search/search-request";
import type { SearchResult } from "../search/search-result";
import type { SearchTarget } from "../search/search-target";
import type { ServiceContext } from "./support/service-context";

/** How far a route's path narrows a search: any segment it names is fixed. */
export interface SearchReach {
  project?: string;
  env?: string;
  collection?: string;
}

/** Full-text search (D30), and the access compilation that bounds it. */
export class SearchService {
  private readonly context: ServiceContext;

  constructor(context: ServiceContext) {
    this.context = context;
  }

  /**
   * Compiles what this caller may search into concrete targets, **before** the
   * query runs. Post-filtering results would leave `total` and every page
   * boundary wrong, and the engine must never see a claim string — the claim
   * grammar belongs to `@silo/shared`, and a second parser of it is a second
   * enforcement point that can disagree with the first.
   *
   * `claims` is null for an anonymous request, which cannot be expressed as
   * claim-derived targets at all: readability comes from the schema's
   * `x-silo-auth`, so the public collections are enumerated instead.
   */
  async access(claims: readonly string[] | null, reach: SearchReach = {}): Promise<SearchAccess> {
    if (claims === null) return { targets: await this.publicTargets(reach) };

    const targets: SearchTarget[] = [];
    for (const raw of claims) {
      // A stored key is validated when it is minted (D12), but a hand-edited or
      // imported record need not be. Skipping an unparseable claim narrows what
      // the caller can reach; throwing would turn one bad record into a 500 on
      // every search.
      let parsed;
      try {
        parsed = Claims.parse(raw);
      } catch {
        continue;
      }

      if (parsed.kind === "root") {
        const everything = SearchService.intersect(
          { project: "*", env: "*", collection: "*" },
          reach
        );
        if (everything) targets.push(everything);
        continue;
      }

      if (parsed.kind !== "collection") continue;
      if (parsed.permission !== Claims.CollectionEntriesRead) continue;

      const target = SearchService.intersect(
        { project: parsed.project!, env: parsed.env!, collection: parsed.name! },
        reach
      );
      if (target) targets.push(target);
    }
    return { targets };
  }

  async run(request: SearchRequest, access: SearchAccess): Promise<SearchResult> {
    const normalized = QueryUtils.normalizeQuery({
      filter: request.filter,
      sort: request.sort,
      limit: request.limit,
      offset: request.offset,
    });
    return this.context.searcher.search(
      {
        ...request,
        filter: normalized.filter,
        sort: normalized.sort,
        limit: normalized.limit,
        offset: normalized.offset,
      },
      access
    );
  }

  capabilities(): { engine: "fts5" | "scan"; snippets: boolean } {
    return this.context.searcher.capabilities();
  }

  async reindex(target?: SearchTarget): Promise<{ collections: number; entries: number }> {
    return this.context.searcher.reindex(target);
  }

  check(): SearchIntegrity | null {
    return this.context.searcher.check();
  }

  /**
   * Collections an anonymous caller may read: those whose schema does not set
   * `x-silo-auth`. A collection with **no** schema is deliberately excluded —
   * an import archive can carry entries with no schema (§6.1), and inferring
   * "public" from an absent declaration would publish content by accident.
   */
  private async publicTargets(reach: SearchReach): Promise<SearchTarget[]> {
    const targets: SearchTarget[] = [];

    for (const scope of await this.context.store.listScopes()) {
      if (reach.project && scope.project !== reach.project) continue;
      if (reach.env && scope.env !== reach.env) continue;

      for (const record of await this.context.store.listCollections(scope)) {
        const name = record.name;
        if (EntryUtils.isSystemCollection(name)) continue;
        if (reach.collection && name !== reach.collection) continue;
        if (SchemaAccess.requiresAuth(record.schema)) continue;
        targets.push({ project: scope.project, env: scope.env, collection: name });
      }
    }
    return targets;
  }

  /**
   * Narrows a claim's target by the reach the route derived from its path. A
   * wildcard segment takes the reach's value; a named segment that disagrees
   * with the reach drops the target entirely. Both directions matter: without
   * the first, a `*` claim would search outside the collection the caller asked
   * about; without the second, a claim for another project would widen a scoped
   * search back out.
   */
  private static intersect(target: SearchTarget, reach: SearchReach): SearchTarget | null {
    const narrow = (claimed: string, asked?: string): string | null => {
      if (asked === undefined) return claimed;
      if (claimed === "*") return asked;
      return claimed === asked ? claimed : null;
    };

    const project = narrow(target.project, reach.project);
    const env = narrow(target.env, reach.env);
    const collection = narrow(target.collection, reach.collection);
    if (project === null || env === null || collection === null) return null;
    return { project, env, collection };
  }
}
