import type { Context } from "hono";
import { SchemaAccess } from "@silo/shared/schema-access";
import { Claims } from "@silo/shared/claims";
import { SiloService } from "../../core/services/silo-service";
import type { KeyInfo } from "../../core/keys/key-info";
import { ValidationError } from "@silo/shared/validation-error";
import { RouteAuth } from "../auth/route-auth";

export class CollectionsRoutes {
  static register(app: any, service: SiloService) {
    const listHandler = async (c: Context) => {
      const scope = RouteAuth.getScope(c);
      const cols = await service.collections.list(scope);
      const key = c.get("keyInfo") as KeyInfo | undefined;
      const visible: any[] = [];

      for (const col of cols) {
        const authEnabled = SchemaAccess.requiresAuth(col.schema);
        const canReadSchema = key
          ? Claims.has(
              key.claims,
              Claims.collection(scope.project, scope.env, col.name, Claims.CollectionSchemaRead),
            )
          : !authEnabled;
        if (canReadSchema) {
          visible.push(col);
        }
      }
      return c.json({ items: visible });
    };

    app.get("/api/projects/:project/environments/:env/collections", listHandler);
    app.get("/api/projects/:project/envs/:env/collections", listHandler);

    const createHandler = async (c: Context) => {
      const scope = RouteAuth.getScope(c);
      const body = await c.req.json();
      if (!body || typeof body !== "object") {
        throw new ValidationError("invalid body: (want {name, schema})");
      }
      if (!body.name) {
        throw new ValidationError(
          'invalid collection name "": want lowercase letter first, then [a-z0-9_-], max 64 chars',
        );
      }
      if (!body.schema) {
        throw new ValidationError("missing schema");
      }
      RouteAuth.requireCollectionClaim(
        c,
        scope.project,
        scope.env,
        body.name,
        Claims.CollectionCreate,
      );
      const col = await service.collections.putSchema(scope, body.name, body.schema);
      return c.json(col, 201);
    };

    app.post("/api/projects/:project/environments/:env/collections", createHandler);
    app.post("/api/projects/:project/envs/:env/collections", createHandler);

    const getSchemaHandler = async (c: Context) => {
      const scope = RouteAuth.getScope(c);
      const name = c.req.param("name") || "";
      const col = await service.collections.get(scope, name);
      RouteAuth.requirePublicOrClaim(
        c,
        scope.project,
        scope.env,
        name,
        Claims.CollectionSchemaRead,
        !SchemaAccess.requiresAuth(col.schema),
      );
      return c.json(col);
    };

    app.get("/api/projects/:project/environments/:env/collections/:name/schema", getSchemaHandler);
    app.get("/api/projects/:project/envs/:env/collections/:name/schema", getSchemaHandler);

    const putSchemaHandler = async (c: Context) => {
      const scope = RouteAuth.getScope(c);
      const name = c.req.param("name") || "";
      const schema = await c.req.json();
      const current = await service.collections.get(scope, name);
      RouteAuth.requireCollectionClaim(
        c,
        scope.project,
        scope.env,
        name,
        Claims.CollectionSchemaUpdate,
      );
      if (SchemaAccess.requiresAuth(current.schema) !== SchemaAccess.requiresAuth(schema)) {
        RouteAuth.requireCollectionClaim(
          c,
          scope.project,
          scope.env,
          name,
          Claims.CollectionAccessUpdate,
        );
      }
      const col = await service.collections.putSchema(scope, name, schema);
      return c.json(col);
    };

    app.put("/api/projects/:project/environments/:env/collections/:name/schema", putSchemaHandler);
    app.put("/api/projects/:project/envs/:env/collections/:name/schema", putSchemaHandler);

    const deleteHandler = async (c: Context) => {
      const scope = RouteAuth.getScope(c);
      const name = c.req.param("name") || "";
      RouteAuth.requireCollectionClaim(
        c,
        scope.project,
        scope.env,
        name,
        Claims.CollectionDelete,
      );
      const force = c.req.query("force") === "true";
      if (force) {
        RouteAuth.requireForcedDelete(c, "deleting a collection", scope.project, scope.env, name);
      }
      await service.collections.delete(scope, name, force);
      return c.body(null, 204);
    };

    app.delete("/api/projects/:project/environments/:env/collections/:name/schema", deleteHandler);
    app.delete("/api/projects/:project/envs/:env/collections/:name/schema", deleteHandler);
  }
}
