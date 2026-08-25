import type { Context } from "hono";
import { Claims } from "@silo/shared/claims";
import { SiloService } from "../../core/services/silo-service";
import { Scope } from "../../core/domain/scope";
import type { KeyInfo } from "../../core/keys/key-info";
import { ValidationError } from "@silo/shared/validation-error";
import { RouteAuth } from "../auth/route-auth";

export class ProjectsRoutes {
  /**
   * `/environments` is the canonical segment (it is what `ApiClient` calls);
   * `/envs` is the short form the API guide shows for hand-written requests.
   * Both are registered from one handler rather than two call sites, so an
   * authorization change can never land on one spelling and miss the other.
   */
  private static both(
    app: any,
    method: "get" | "post" | "delete",
    suffix: string,
    handler: (c: Context) => Promise<Response>
  ): void {
    app[method](`/api/projects/:project/environments${suffix}`, handler);
    app[method](`/api/projects/:project/envs${suffix}`, handler);
  }

  static register(app: any, service: SiloService) {
    // List all projects.
    //
    // Visibility is per-project: a key sees a project it holds a collection
    // claim for, and nothing else. Fixed claims (`media:read`, `keys:read`,
    // `transfer:*`) deliberately do not count — they say nothing about which
    // projects their holder may see, and treating them as instance-wide
    // visibility handed the whole tenant list to, say, a media-only key.
    app.get("/api/projects", async (c: Context) => {
      const projects = await service.scopes.listProjects();
      const key = c.get("keyInfo") as KeyInfo | undefined;
      if (!key) {
        const publicScopes = await service.scopes.publicScopes();
        return c.json({ items: projects.filter((p) => publicScopes.has(p)) });
      }

      const parsed = ProjectsRoutes.parseClaims(key);
      const visible = projects.filter((p) =>
        parsed.some(
          (claim) =>
            claim.kind === "root" ||
            (claim.kind === "collection" && (claim.project === "*" || claim.project === p))
        )
      );
      return c.json({ items: visible });
    });

    // Create a project
    app.post("/api/projects", async (c: Context) => {
      const body = await c.req.json();
      if (!body || typeof body !== "object") {
        throw new ValidationError("invalid body: (want {id} or {project})");
      }
      const project = body.id || body.name || body.project;
      if (!project || typeof project !== "string") {
        throw new ValidationError(
          'invalid project id "": want lowercase letter first, then [a-z0-9_-], max 64 chars',
        );
      }
      Scope.validateProject(project);
      RouteAuth.requireCollectionClaim(
        c,
        project,
        "*",
        "*",
        Claims.CollectionCreate,
      );
      await service.scopes.createProject(project);
      return c.json({ id: project, project }, 201);
    });

    // Delete a project
    app.delete("/api/projects/:project", async (c: Context) => {
      const project = c.req.param("project") || "";
      Scope.validateProject(project);
      RouteAuth.requireCollectionClaim(
        c,
        project,
        "*",
        "*",
        Claims.CollectionDelete,
      );
      const force = c.req.query("force") === "true";
      if (force) {
        RouteAuth.requireForcedDelete(c, "deleting a project", project, "*", "*");
      }
      await service.scopes.deleteProject(project, force, RouteAuth.getWriteContext(c));
      return c.body(null, 204);
    });

    // List environments in a project
    ProjectsRoutes.both(app, "get", "", async (c: Context) => {
      const project = c.req.param("project") || "";
      Scope.validateProject(project);
      const envs = await service.scopes.listEnvironments(project);
      const key = c.get("keyInfo") as KeyInfo | undefined;
      if (!key) {
        const publicEnvs = (await service.scopes.publicScopes()).get(project);
        return c.json({ items: publicEnvs ? envs.filter((e) => publicEnvs.has(e)) : [] });
      }

      const parsed = ProjectsRoutes.parseClaims(key);
      const visible = envs.filter((env) => parsed.some((claim) => claim.matchesScope(project, env)));
      return c.json({ items: visible });
    });

    // Create an environment in a project
    ProjectsRoutes.both(app, "post", "", async (c: Context) => {
      const project = c.req.param("project") || "";
      const body = await c.req.json();
      if (!body || typeof body !== "object") {
        throw new ValidationError("invalid body: (want {id} or {env})");
      }
      const env = body.id || body.name || body.env;
      if (!env || typeof env !== "string") {
        throw new ValidationError(
          'invalid env id "": want lowercase letter first, then [a-z0-9_-], max 64 chars',
        );
      }
      const scope = Scope.of(project, env);
      RouteAuth.requireCollectionClaim(
        c,
        scope.project,
        scope.env,
        "*",
        Claims.CollectionCreate,
      );
      await service.scopes.createEnvironment(scope.project, scope.env);
      return c.json({ id: scope.env, project: scope.project, env: scope.env }, 201);
    });

    // Delete an environment in a project
    ProjectsRoutes.both(app, "delete", "/:env", async (c: Context) => {
      const project = c.req.param("project") || "";
      const env = c.req.param("env") || "";
      const scope = Scope.of(project, env);
      RouteAuth.requireCollectionClaim(
        c,
        scope.project,
        scope.env,
        "*",
        Claims.CollectionDelete,
      );
      const force = c.req.query("force") === "true";
      if (force) {
        RouteAuth.requireForcedDelete(c, "deleting an environment", scope.project, scope.env, "*");
      }
      await service.scopes.deleteEnvironment(
        scope.project,
        scope.env,
        force,
        RouteAuth.getWriteContext(c)
      );
      return c.body(null, 204);
    });
  }

  /** Unparseable claims are skipped, matching `Claims.has`. */
  private static parseClaims(key: KeyInfo) {
    return key.claims.flatMap((claim) => {
      try {
        return [Claims.parse(claim)];
      } catch {
        return [];
      }
    });
  }
}
