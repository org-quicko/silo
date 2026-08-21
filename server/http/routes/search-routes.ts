import type { Context } from "hono";
import { ValidationError } from "@silo/shared/validation-error";
import type { Service } from "../../core/service/service";
import type { KeyInfo } from "../../core/keys/key-info";
import { EntryUtils } from "../../core/domain/entry-utils";
import { Scope } from "../../core/domain/scope";
import { QueryUtils } from "../../core/query/query-utils";
import { RequestUtils } from "./request-utils";

/**
 * Search at three reaches (D30). The reach is in the **path**, following D19
 * and fixing a failure direction a query parameter would have: a missing
 * `?project=` would silently widen a search to the whole instance, bounded
 * only by the key.
 *
 * `GET` is the only method. `filter` is the same url-encoded JSON the list
 * route already accepts, under the same `MaxFilterNodes`/`MaxFilterDepth`
 * caps, so a request body buys nothing and would cost a duplicate surface, a
 * second place to wire `entries:read`, and a search that cannot be linked to.
 */
export class SearchRoutes {
  static register(app: any, svc: Service) {
    const handler = async (c: Context) => {
      const project = c.req.param("project");
      const env = c.req.param("env");
      const collection = c.req.param("name");

      // Validate scope ids at the boundary the same way every scoped route
      // does, so a malformed project id is a 400 here rather than a search
      // that quietly matches nothing.
      if (project !== undefined && env !== undefined) Scope.of(project, env);

      const key = c.get("keyInfo") as KeyInfo | undefined;
      const access = await svc.searchAccess(key ? key.claims : null, {
        project,
        env,
        collection,
      });

      const res = await svc.search(
        {
          q: c.req.query("q") || undefined,
          project,
          env,
          collection,
          filter: SearchRoutes.filter(c.req.query("filter")),
          sort: QueryUtils.parseSort(c.req.query("sort") || ""),
          limit: SearchRoutes.number(c.req.query("limit"), "limit") ?? 0,
          offset: SearchRoutes.number(c.req.query("offset"), "offset") ?? 0,
        },
        access
      );

      const baseUrl = RequestUtils.getBaseUrl(c);
      // One schema lookup per distinct collection on the page, not per hit —
      // a page of 50 results from one collection would otherwise fetch the
      // same schema 50 times.
      const schemas = new Map<string, any>();
      const data = [];
      for (const hit of res.items) {
        const cacheKey = `${hit.project}/${hit.env}/${hit.collection}`;
        if (!schemas.has(cacheKey)) {
          schemas.set(cacheKey, await SearchRoutes.schemaOf(svc, hit.project, hit.env, hit.collection));
        }
        data.push({
          project: hit.project,
          env: hit.env,
          collection: hit.collection,
          // The location sits on the hit; the entry stays exactly what the
          // API returns everywhere else (§5.1, and the exception D30 records).
          entry: EntryUtils.toApiResponse(hit.entry, schemas.get(cacheKey), baseUrl),
          snippets: hit.snippets,
        });
      }

      return c.json({
        data,
        total: res.total,
        limit: res.limit,
        offset: res.offset,
        truncated: res.truncated,
        engine: res.engine,
      });
    };

    // Registered before the entry routes: Hono matches in registration order,
    // so `/collections/{name}/search` would otherwise be captured by the
    // `/collections/{name}/{id}` entry route with an id of "search".
    app.get("/api/projects/:project/environments/:env/collections/:name/search", handler);
    app.get("/api/projects/:project/envs/:env/collections/:name/search", handler);
    app.get("/api/projects/:project/environments/:env/search", handler);
    app.get("/api/projects/:project/envs/:env/search", handler);
    app.get("/api/search", handler);
  }

  private static async schemaOf(
    svc: Service,
    project: string,
    env: string,
    collection: string
  ): Promise<any> {
    try {
      return (await svc.getCollection(Scope.of(project, env), collection)).schema;
    } catch {
      // A collection can hold entries with no schema (§6.1). That is not an
      // error here — it only means no media fields can be resolved.
      return undefined;
    }
  }

  private static filter(raw: string | undefined): any {
    if (!raw) return undefined;
    try {
      return JSON.parse(raw);
    } catch (err: any) {
      throw new ValidationError(`invalid filter JSON: ${err.message}`);
    }
  }

  private static number(raw: string | undefined, name: string): number | undefined {
    if (!raw) return undefined;
    const n = Number.parseInt(raw, 10);
    if (Number.isNaN(n)) throw new ValidationError(`invalid ${name} "${raw}"`);
    return n;
  }
}
