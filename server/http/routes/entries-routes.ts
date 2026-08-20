import type { Context } from "hono";
import { SchemaAccess } from "@silo/shared/schema-access";
import { Claims } from "@silo/shared/claims";
import { Service } from "../../core/service/service";
import { ValidationError } from "@silo/shared/validation-error";
import { QueryUtils } from "../../core/query/query-utils";
import { EntryUtils } from "../../core/domain/entry-utils";
import { RouteAuth } from "../auth/route-auth";
import { RequestUtils } from "./request-utils";

export class EntriesRoutes {
  static register(app: any, svc: Service) {
    const listHandler = async (c: Context) => {
      const scope = RouteAuth.getScope(c);
      const name = c.req.param("name") || "";
      const col = await svc.getCollection(scope, name);
      RouteAuth.requirePublicOrClaim(
        c,
        scope.project,
        scope.env,
        name,
        Claims.CollectionEntriesRead,
        !SchemaAccess.requiresAuth(col.schema),
      );

      const limitStr = c.req.query("limit");
      const offsetStr = c.req.query("offset");
      const filterStr = c.req.query("filter");
      const sortStr = c.req.query("sort") || "";

      const limit = limitStr ? parseInt(limitStr, 10) : undefined;
      if (limitStr && isNaN(limit!)) {
        throw new ValidationError(`invalid limit "${limitStr}"`);
      }
      const offset = offsetStr ? parseInt(offsetStr, 10) : undefined;
      if (offsetStr && isNaN(offset!)) {
        throw new ValidationError(`invalid offset "${offsetStr}"`);
      }

      let filter: any = undefined;
      if (filterStr) {
        try {
          filter = JSON.parse(filterStr);
        } catch (err: any) {
          throw new ValidationError(`invalid filter JSON: ${err.message}`);
        }
      }

      const sort = QueryUtils.parseSort(sortStr);

      const res = await svc.listEntries(scope, name, { limit, offset, filter, sort });
      const baseUrl = RequestUtils.getBaseUrl(c);
      return c.json({
        data: res.items.map((item) => EntryUtils.toApiResponse(item, col.schema, baseUrl)),
        total: res.total,
        limit: res.limit,
        offset: res.offset,
      });
    };

    app.get("/api/projects/:project/environments/:env/collections/:name", listHandler);
    app.get("/api/projects/:project/envs/:env/collections/:name", listHandler);

    const createHandler = async (c: Context) => {
      const scope = RouteAuth.getScope(c);
      const name = c.req.param("name") || "";
      const col = await svc.getCollection(scope, name);
      RouteAuth.requireCollectionClaim(
        c,
        scope.project,
        scope.env,
        name,
        Claims.CollectionEntriesCreate,
      );
      const data = await c.req.json();
      const e = await svc.createEntry(scope, name, data);
      const baseUrl = RequestUtils.getBaseUrl(c);
      return c.json(EntryUtils.toApiResponse(e, col.schema, baseUrl), 201);
    };

    app.post("/api/projects/:project/environments/:env/collections/:name", createHandler);
    app.post("/api/projects/:project/envs/:env/collections/:name", createHandler);

    const getHandler = async (c: Context) => {
      const scope = RouteAuth.getScope(c);
      const name = c.req.param("name") || "";
      const id = c.req.param("id") || "";
      const col = await svc.getCollection(scope, name);
      RouteAuth.requirePublicOrClaim(
        c,
        scope.project,
        scope.env,
        name,
        Claims.CollectionEntriesRead,
        !SchemaAccess.requiresAuth(col.schema),
      );
      const e = await svc.getEntry(scope, name, id);
      const baseUrl = RequestUtils.getBaseUrl(c);
      return c.json(EntryUtils.toApiResponse(e, col.schema, baseUrl));
    };

    app.get("/api/projects/:project/environments/:env/collections/:name/:id", getHandler);
    app.get("/api/projects/:project/envs/:env/collections/:name/:id", getHandler);

    const updateHandler = async (c: Context) => {
      const scope = RouteAuth.getScope(c);
      const name = c.req.param("name") || "";
      const id = c.req.param("id") || "";
      const col = await svc.getCollection(scope, name);
      RouteAuth.requireCollectionClaim(
        c,
        scope.project,
        scope.env,
        name,
        Claims.CollectionEntriesUpdate,
      );
      const rev = RouteAuth.getExpectedRev(c);
      const data = await c.req.json();
      const e = await svc.updateEntry(scope, name, id, data, rev);
      const baseUrl = RequestUtils.getBaseUrl(c);
      return c.json(EntryUtils.toApiResponse(e, col.schema, baseUrl));
    };

    app.put("/api/projects/:project/environments/:env/collections/:name/:id", updateHandler);
    app.put("/api/projects/:project/envs/:env/collections/:name/:id", updateHandler);

    const deleteHandler = async (c: Context) => {
      const scope = RouteAuth.getScope(c);
      const name = c.req.param("name") || "";
      const id = c.req.param("id") || "";
      RouteAuth.requireCollectionClaim(
        c,
        scope.project,
        scope.env,
        name,
        Claims.CollectionEntriesDelete,
      );
      const rev = RouteAuth.getExpectedRev(c);
      await svc.deleteEntry(scope, name, id, rev);
      return c.body(null, 204);
    };

    app.delete("/api/projects/:project/environments/:env/collections/:name/:id", deleteHandler);
    app.delete("/api/projects/:project/envs/:env/collections/:name/:id", deleteHandler);
  }
}
