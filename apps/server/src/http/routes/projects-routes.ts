import type { Context } from "hono";
import { Claims } from "@silo/shared/claims";
import { SiloService } from "../../core/services/silo-service";
import type { EnvironmentRecord } from "../../core/domain/environment-record";
import type { ProjectRecord } from "../../core/domain/project-record";
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
    method: "get" | "post" | "delete" | "patch",
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
        return c.json({
          items: projects.filter((p) => publicScopes.has(p.name)).map(ProjectsRoutes.projectView),
        });
      }

      const parsed = ProjectsRoutes.parseClaims(key);
      const visible = projects.filter((p) =>
        parsed.some(
          (claim) =>
            claim.kind === "root" ||
            (claim.kind === "collection" && (claim.project === "*" || claim.project === p.name))
        )
      );
      return c.json({ items: visible.map(ProjectsRoutes.projectView) });
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
      const record = await service.scopes.createProject(project);
      return c.json(ProjectsRoutes.projectView(record), 201);
    });

    // Rename a project.
    //
    // Addressed by its current name like every other route, and bound to its id
    // with `?expected_id=` so a request delayed in flight cannot rename whatever
    // took the name in the meantime (D51). `?dry_run=true` answers with what
    // *would* change and writes nothing.
    app.patch("/api/projects/:project", async (c: Context) => {
      const project = c.req.param("project") || "";
      Scope.validateProject(project);
      const name = await ProjectsRoutes.readName(c, "project");

      RouteAuth.requireRename(c, "a project", project, "*", "*");
      if (ProjectsRoutes.isDryRun(c)) {
        return c.json(await service.renames.previewProject(project, name));
      }

      Scope.validateProject(name);
      RouteAuth.requireRename(c, "a project", name, "*", "*");
      const preview = await service.renames.renameProject(
        project,
        name,
        RouteAuth.getActor(c),
        c.req.query("expected_id") || undefined,
      );
      return c.json(preview);
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
        const visible = publicEnvs ? envs.filter((e) => publicEnvs.has(e.name)) : [];
        return c.json({ items: visible.map(ProjectsRoutes.environmentView) });
      }

      const parsed = ProjectsRoutes.parseClaims(key);
      const visible = envs.filter((env) =>
        parsed.some((claim) => claim.matchesScope(project, env.name)),
      );
      return c.json({ items: visible.map(ProjectsRoutes.environmentView) });
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
      const record = await service.scopes.createEnvironment(scope.project, scope.env);
      return c.json(ProjectsRoutes.environmentView(record), 201);
    });

    // Rename an environment. Registered through `both`, so the `/envs` spelling
    // cannot end up with different authorization from `/environments`.
    ProjectsRoutes.both(app, "patch", "/:env", async (c: Context) => {
      const scope = RouteAuth.getScope(c);
      const name = await ProjectsRoutes.readName(c, "env");

      RouteAuth.requireRename(c, "an environment", scope.project, scope.env, "*");
      if (ProjectsRoutes.isDryRun(c)) {
        return c.json(
          await service.renames.previewEnvironment(scope.project, scope.env, name),
        );
      }

      Scope.validateEnv(name);
      RouteAuth.requireRename(c, "an environment", scope.project, name, "*");
      const preview = await service.renames.renameEnvironment(
        scope.project,
        scope.env,
        name,
        RouteAuth.getActor(c),
        c.req.query("expected_id") || undefined,
      );
      return c.json(preview);
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

  /** `id` is the record's ULID and `name` is what every path addresses (D51). */
  private static projectView(record: ProjectRecord) {
    return { id: record.id, name: record.name };
  }

  private static environmentView(record: EnvironmentRecord) {
    return { id: record.id, name: record.name, project_id: record.project_id };
  }

  /** A rename body is `{name}`. `{id}` is deliberately **not** accepted as a
   *  synonym the way the create routes take it: since D51 `id` means the ULID,
   *  and reading it as a new name here would be the one place the two words
   *  swapped meaning. */
  private static async readName(c: Context, label: string): Promise<string> {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      throw new ValidationError("invalid body: (want {name})");
    }
    const name = body.name;
    if (!name || typeof name !== "string") {
      throw new ValidationError(
        `invalid ${label} name "": want lowercase letter first, then [a-z0-9_-], max 64 chars`,
      );
    }
    return name;
  }

  private static isDryRun(c: Context): boolean {
    return c.req.query("dry_run") === "true";
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
