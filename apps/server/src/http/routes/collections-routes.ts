import type { Context } from "hono";
import { SchemaAccess } from "@silo/shared/schema-access";
import { Claims } from "@silo/shared/claims";
import { SiloService } from "../../core/services/silo-service";
import type { KeyInfo } from "../../core/keys/key-info";
import { ValidationError } from "@silo/shared/validation-error";
import { RouteAuth } from "../auth/route-auth";

export class CollectionsRoutes {
  static register(app: any, service: SiloService) {
    /** Which of `names` this request may read the schema of. Anonymous reads
     *  reach only the collections that have not turned `x-silo-auth` on. */
    const readable = (c: Context, scope: any, name: string, requiresAuth: boolean) => {
      const key = c.get("keyInfo") as KeyInfo | undefined;
      return key
        ? Claims.has(
            key.claims,
            Claims.collection(scope.project, scope.env, name, Claims.CollectionSchemaRead),
          )
        : !requiresAuth;
    };

    // The listing answers **summaries** — name, entry count, access,
    // timestamps — and no schema (D54). A schema is the largest thing a
    // collection carries and the one thing a list of them never draws.
    const listHandler = async (c: Context) => {
      const scope = RouteAuth.getScope(c);
      const summaries = await service.collections.summaries(scope);
      const visible = summaries.filter((summary) =>
        readable(c, scope, summary.name, summary.requires_auth),
      );
      return c.json({ items: visible });
    };

    app.get("/api/projects/:project/environments/:env/collections", listHandler);
    app.get("/api/projects/:project/envs/:env/collections", listHandler);

    // Every schema in the scope, for the callers that genuinely need all of
    // them at once — a form resolving `silo://` refs across collections, a
    // client validating without a round trip per type.
    //
    // A sibling of `collections` rather than a path beneath it: `schemas` is a
    // legal collection name, so `/collections/schemas` would shadow the entry
    // list of a collection actually called that.
    const schemasHandler = async (c: Context) => {
      const scope = RouteAuth.getScope(c);
      const cols = await service.collections.list(scope);
      const visible = cols.filter((col) =>
        readable(c, scope, col.name, SchemaAccess.requiresAuth(col.schema)),
      );
      return c.json({ items: visible });
    };

    app.get("/api/projects/:project/environments/:env/schemas", schemasHandler);
    app.get("/api/projects/:project/envs/:env/schemas", schemasHandler);

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

    // Bundled on the way out (D54), so one collection's schema is a document a
    // client can render on its own — which is what makes fetching every schema
    // in the scope unnecessary rather than merely wasteful.
    const getSchemaHandler = async (c: Context) => {
      const scope = RouteAuth.getScope(c);
      const name = c.req.param("name") || "";
      const col = await service.collections.getBundled(scope, name);
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

    // Rename a collection.
    //
    // Distinct from the other two renames in one way: `$ref`s address
    // collections by name, so this rewrites every referring schema as well
    // (D51) — which is why it also asks for `collections:schema:update` on each
    // of them, up front, rather than discovering the refusal half way through.
    const renameHandler = async (c: Context) => {
      const scope = RouteAuth.getScope(c);
      const from = c.req.param("name") || "";
      const body = await c.req.json().catch(() => null);
      if (!body || typeof body !== "object" || !body.name || typeof body.name !== "string") {
        throw new ValidationError("invalid body: (want {name})");
      }
      const to = body.name;

      RouteAuth.requireRename(c, "a collection", scope.project, scope.env, from);
      for (const referrer of await service.collections.referrers(scope, from)) {
        RouteAuth.requireCollectionClaim(
          c,
          scope.project,
          scope.env,
          referrer,
          Claims.CollectionSchemaUpdate,
        );
      }

      if (c.req.query("dry_run") === "true") {
        return c.json(await service.renames.previewCollection(scope, from, to));
      }

      RouteAuth.requireRename(c, "a collection", scope.project, scope.env, to);
      const preview = await service.renames.renameCollection(
        scope,
        from,
        to,
        RouteAuth.getActor(c),
        c.req.query("expected_id") || undefined,
      );
      return c.json(preview);
    };

    app.patch("/api/projects/:project/environments/:env/collections/:name", renameHandler);
    app.patch("/api/projects/:project/envs/:env/collections/:name", renameHandler);

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
      await service.collections.delete(scope, name, force, RouteAuth.getWriteContext(c));
      return c.body(null, 204);
    };

    app.delete("/api/projects/:project/environments/:env/collections/:name/schema", deleteHandler);
    app.delete("/api/projects/:project/envs/:env/collections/:name/schema", deleteHandler);
  }
}
