import type { Entry } from "../entries/entry.js";
import { PageWindow } from "../pagination/page-window.js";
import type { RequestOptions } from "../request-options.js";
import { PagePayload } from "../transport/page-payload.js";
import type { Transport } from "../transport/transport.js";
import type { SearchEngine } from "./search-engine.js";
import type { SearchHit } from "./search-hit.js";
import { SearchPage } from "./search-page.js";
import type { SearchQuery } from "./search-query.js";
import type { SearchReach } from "./search-reach.js";

interface SearchHitPayload {
  project: string;
  env: string;
  collection: string;
  entry: Entry;
  snippets: SearchHit["snippets"];
}

/**
 * Search, bound to one reach: a collection, an environment, or the
 * whole instance. `CollectionHandle.search`, `EnvironmentHandle.search` and
 * the root `Silo.search` each construct one of these against their own
 * reach rather than exposing a reach as an argument that could be forgotten.
 */
export class Search {
  constructor(
    private readonly transport: Transport,
    private readonly reach: SearchReach,
  ) {}

  async run(query: SearchQuery, options: RequestOptions = {}): Promise<SearchPage> {
    const loader = (window: PageWindow): Promise<SearchPage> =>
      this.run({ ...query, limit: window.limit, offset: window.offset }, options);

    const body = await this.transport.json<Record<string, unknown>>({
      method: "GET",
      path: this.reach.path,
      query: {
        q: query.query,
        filter: query.where?.toJSON(),
        sort: query.sort === undefined ? undefined : String(query.sort),
        limit: query.limit,
        offset: query.offset,
      },
      ...options,
    });

    const page = PagePayload.read<SearchHitPayload>(body);
    const window = new PageWindow(page.limit ?? query.limit ?? 50, page.offset ?? query.offset ?? 0);
    const truncated = body.truncated === true;
    const engine = body.engine as SearchEngine;
    const hits = page.rows.map((hit) => Search.toHit(hit));

    return new SearchPage(hits, page.total, window, truncated, engine, loader);
  }

  /** `env` is the only rename: the hit's own location, which sits here rather
   * than on the entry so a result found outside the scope on screen can still
   * be linked to. */
  private static toHit(payload: SearchHitPayload): SearchHit {
    return {
      project: payload.project,
      environment: payload.env,
      collection: payload.collection,
      entry: payload.entry,
      snippets: payload.snippets,
    };
  }
}
