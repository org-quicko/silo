import type { Context } from "hono";
import { Claims } from "@silo/shared/claims";
import { ValidationError } from "@silo/shared/validation-error";
import type { SiloService } from "../../core/services/silo-service";
import { Scope } from "../../core/domain/scope";
import { ForbiddenError } from "../../core/errors/forbidden-error";
import { RouteAuth } from "../auth/route-auth";

/**
 * Variables: `{{NAME}}` declared once per project, valued per environment
 * (D57).
 *
 * **The paths follow the reach, not the page.** A declaration is
 * project-shaped, so declaring, renaming and undeclaring hang off
 * `/api/projects/{project}/variables`; a value is environment-shaped, so
 * reading and writing one hangs off
 * `/api/projects/{project}/environments/{env}/variables`. The admin's single
 * Variables page calls both, which is the right way round: putting the
 * project-wide delete under an environment path would make one environment's
 * settings screen quietly the place every environment's value disappears from.
 *
 * **No new claims** (D57). Every check below is an existing claim at an
 * existing reach, chosen to match what the operation actually does:
 *
 * - **Reading** needs `entries:read` on *any* collection in the environment.
 *   That is the honest floor rather than a concession: a value is substituted
 *   into every entry that references it, so anyone who can read one entry can
 *   already see it. Requiring more would guard a secret that is not one.
 * - **Setting a value** needs `entries:update` across the whole environment
 *   (`collections:{project}/{env}/*:entries:update`). Changing one value
 *   rewrites what *every* entry in that environment answers, so it is exactly
 *   a scope-wide content edit and asks for scope-wide content authority — the
 *   same reasoning `RouteAuth.requireScopeWide` already carries for a
 *   scope-to-scope copy.
 * - **Declaring** and **undeclaring** reach every environment in the project,
 *   so they ask at `{project}` / `*` / `*` for `create` and `delete`
 *   respectively — what creating and deleting an environment already ask for
 *   at that reach.
 *
 * A **description** is metadata about the declaration, so rewriting one asks
 * the declaration's own authority rather than the value's.
 */
export class VariablesRoutes {
  /** `/environments` and `/envs` from one handler, `ProjectsRoutes.both`'s rule
   *  and for its reason: authorization must not be able to land on one
   *  spelling and miss the other. */
  private static both(
    app: any,
    method: "get" | "post" | "put" | "delete" | "patch",
    suffix: string,
    handler: (c: Context) => Promise<Response>,
  ): void {
    app[method](`/api/projects/:project/environments/:env/variables${suffix}`, handler);
    app[method](`/api/projects/:project/envs/:env/variables${suffix}`, handler);
  }

  static register(app: any, service: SiloService) {
    // ---- declarations: project-shaped ----

    // Declare a name in the project, optionally valuing it in one environment.
    //
    // `?env=` is how the admin's one form does both halves in one request. It
    // is a query parameter rather than a second path, because the *subject* is
    // the project's declaration; the environment only says where the initial
    // value lands, and it is authorized separately below.
    app.post("/api/projects/:project/variables", async (c: Context) => {
      const project = c.req.param("project") || "";
      Scope.validateProject(project);
      RouteAuth.requireCollectionClaim(c, project, "*", "*", Claims.CollectionCreate);

      const body = await VariablesRoutes.body(c);
      const name = VariablesRoutes.string(body.name, "name");
      const description = body.description === undefined ? "" : body.description;
      const value = body.value;

      // An initial value is a value, so it is held to the value authority too.
      // Without this, `create` at the project would be a way to write one
      // environment's content while holding none of that environment's.
      const env = c.req.query("env") || Scope.Default.env;
      const scope = Scope.of(project, env);
      if (value !== undefined) {
        RouteAuth.requireScopeWide(c, "setting a variable value", scope.project, scope.env, [
          Claims.CollectionEntriesUpdate,
        ]);
      }

      const view = await service.variables.declare(
        scope,
        name,
        description as string,
        value as string | undefined,
      );
      return c.json(view, 201);
    });

    // Rename a declaration, or rewrite its description.
    //
    // A rename rewrites **no content**: every `{{OLD}}` already stored keeps
    // standing as an unresolved reference. That is deliberate and is the
    // opposite of D51's cascade, because a claim naming a scope is authority
    // while a template in an entry is text somebody wrote — silently repointing
    // it at a value it was never aimed at is the worse of the two failures. The
    // admin says so before it happens.
    app.patch("/api/projects/:project/variables/:name", async (c: Context) => {
      const project = c.req.param("project") || "";
      Scope.validateProject(project);
      const name = c.req.param("name") || "";
      const body = await VariablesRoutes.body(c);

      // A rename is a create at the new name and a delete at the old, the pair
      // `RenamePermissions` already states for the other three record kinds.
      if (body.name !== undefined) {
        RouteAuth.requireCollectionClaim(c, project, "*", "*", Claims.CollectionCreate);
        RouteAuth.requireCollectionClaim(c, project, "*", "*", Claims.CollectionDelete);
      } else {
        RouteAuth.requireCollectionClaim(c, project, "*", "*", Claims.CollectionCreate);
      }

      const view = await service.variables.updateDeclaration(
        Scope.of(project, c.req.query("env") || Scope.Default.env),
        name,
        {
          name: body.name === undefined ? undefined : VariablesRoutes.string(body.name, "name"),
          description:
            body.description === undefined
              ? undefined
              : VariablesRoutes.string(body.description, "description", true),
        },
      );
      return c.json(view);
    });

    // Undeclare a name, and every environment's value with it.
    app.delete("/api/projects/:project/variables/:name", async (c: Context) => {
      const project = c.req.param("project") || "";
      Scope.validateProject(project);
      RouteAuth.requireCollectionClaim(c, project, "*", "*", Claims.CollectionDelete);

      await service.variables.undeclare(
        Scope.of(project, c.req.query("env") || Scope.Default.env),
        c.req.param("name") || "",
      );
      return c.body(null, 204);
    });

    // ---- values: environment-shaped ----

    // Every declaration in the project, with this environment's value.
    VariablesRoutes.both(app, "get", "", async (c: Context) => {
      const scope = RouteAuth.getScope(c);
      VariablesRoutes.requireRead(c, scope);
      return c.json({ items: await service.variables.list(scope) });
    });

    // Set this environment's value. Every other environment's is untouched.
    VariablesRoutes.both(app, "put", "/:name", async (c: Context) => {
      const scope = RouteAuth.getScope(c);
      RouteAuth.requireScopeWide(c, "setting a variable value", scope.project, scope.env, [
        Claims.CollectionEntriesUpdate,
      ]);

      const body = await VariablesRoutes.body(c);
      const value = VariablesRoutes.string(body.value, "value", true);
      return c.json(await service.variables.setValue(scope, c.req.param("name") || "", value));
    });

    // Clear this environment's value, leaving the name declared.
    //
    // Authorized as an update rather than a delete: the declaration survives,
    // and what changes is what this environment's entries answer.
    VariablesRoutes.both(app, "delete", "/:name", async (c: Context) => {
      const scope = RouteAuth.getScope(c);
      RouteAuth.requireScopeWide(c, "clearing a variable value", scope.project, scope.env, [
        Claims.CollectionEntriesUpdate,
      ]);
      return c.json(await service.variables.clearValue(scope, c.req.param("name") || ""));
    });
  }

  /**
   * `entries:read` on any collection in the environment.
   *
   * `hasAnyCollectionPermission` rather than a scope-wide check, because a key
   * that can read one collection can already see every value referenced from
   * it — the list adds no reach, only convenience. A key with no read at all in
   * the environment gets a 403 rather than an empty list, so "you cannot see
   * this" is never mistaken for "there are none".
   */
  private static requireRead(c: Context, scope: Scope): void {
    const key = RouteAuth.requireKey(c);
    if (
      !Claims.hasAnyCollectionPermission(
        key.claims,
        Claims.CollectionEntriesRead,
        scope.project,
        scope.env,
      )
    ) {
      throw new ForbiddenError(
        `reading variables in ${scope.key()} needs "entries:read" on a collection there`,
      );
    }
  }

  private static async body(c: Context): Promise<Record<string, unknown>> {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new ValidationError("invalid body: want a JSON object");
    }
    return body as Record<string, unknown>;
  }

  /** `allowEmpty` is the difference between a field that may be blank (a value,
   *  a description) and one that may not (a name). */
  private static string(raw: unknown, label: string, allowEmpty = false): string {
    if (typeof raw !== "string" || (!allowEmpty && raw.length === 0)) {
      throw new ValidationError(`invalid ${label}: must be a non-empty string`);
    }
    return raw;
  }
}
