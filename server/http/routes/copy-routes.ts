import type { Context } from "hono";
import { Claims } from "@silo/shared/claims";
import type { Service } from "../../core/service/service";
import { ValidationError } from "@silo/shared/validation-error";
import { HttpSiloClient } from "../../adapters/http/http-silo-client";
import { Scope } from "../../core/domain/scope";
import { RouteAuth } from "../auth/route-auth";
import type { CopyRequest } from "./copy-request";
import type { ScopeCopyRequest } from "./scope-copy-request";

export class CopyRoutes {
  static register(app: any, svc: Service) {
    CopyRoutes.registerScopeCopy(app, svc);

    app.post("/api/copy", async (c: Context) => {
      const key = RouteAuth.requireClaim(c, Claims.TransferCopy);
      // A copy is an import of a remote instance's full archive, so it needs
      // the same instance-wide write authority a local import does.
      RouteAuth.requireInstanceWide(c, "copy", Claims.TransferWritePermissions);
      const body = await CopyRoutes.readBody(c);
      CopyRoutes.validateOptions(body);
      if (body.with_keys === true) RouteAuth.requireClaim(c, Claims.KeysImport);

      const source = new HttpSiloClient(body.source_url, body.source_api_key);
      const archive = await source.exportArchive(body.with_keys === true);
      const result = await svc.importTarGz(archive, {
        mode: body.mode,
        dryRun: body.dry_run,
        validate: body.validate,
        prefer: body.prefer,
        allowKeys: Claims.has(key.claims, Claims.KeysImport),
      });

      return c.json(result);
    });
  }

  /**
   * Copy one scope of this instance onto another (D22) — the env→env move
   * that previously needed a full archive round trip.
   *
   * Destination-driven like `/api/copy` above: the route names the
   * destination and the body names the source. Authorization asks only for
   * the scoped collection permissions the equivalent read-then-write loop
   * would need — deliberately no `transfer:*` claim, since this route reaches
   * no scope the caller could not already reach one entry at a time.
   *
   * Both `/environments` and `/envs` are registered from one handler, for the
   * reason `ProjectsRoutes` gives: an authorization change must not be able to
   * land on one spelling and miss the other.
   */
  private static registerScopeCopy(app: any, svc: Service): void {
    const handler = async (c: Context) => {
      const to = RouteAuth.getScope(c);
      const body = await CopyRoutes.readScopeBody(c);
      const from = CopyRoutes.validateScopeOptions(body);

      const mode = body.mode || "merge";
      RouteAuth.requireScopeWide(c, "a scope copy's source", from.project, from.env, Claims.ScopeCopyReadPermissions);
      RouteAuth.requireScopeWide(c, "a scope copy's destination", to.project, to.env, Claims.ScopeCopyWritePermissions);
      if (mode === "replace") {
        RouteAuth.requireScopeWide(
          c,
          'a scope copy in "replace" mode',
          to.project,
          to.env,
          Claims.ScopeCopyReplacePermissions,
        );
      }

      const result = await svc.copyScope(from, to, {
        mode,
        dryRun: body.dry_run,
        validate: body.validate,
        prefer: body.prefer,
      });
      return c.json(result);
    };

    app.post("/api/projects/:project/environments/:env/copy", handler);
    app.post("/api/projects/:project/envs/:env/copy", handler);
  }

  private static async readScopeBody(c: Context): Promise<ScopeCopyRequest> {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      throw new ValidationError("invalid JSON body");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new ValidationError("invalid body: want {from: {project, env}}");
    }
    return body as ScopeCopyRequest;
  }

  /** Returns the validated source scope; the destination comes from the path. */
  private static validateScopeOptions(body: ScopeCopyRequest): Scope {
    const from = body.from;
    if (!from || typeof from !== "object" || Array.isArray(from)) {
      throw new ValidationError("from is required: want {from: {project, env}}");
    }
    if (body.mode !== undefined && body.mode !== "merge" && body.mode !== "replace") {
      throw new ValidationError(`invalid copy mode "${body.mode}"`);
    }
    if (body.prefer !== undefined && body.prefer !== "local" && body.prefer !== "remote") {
      throw new ValidationError(`invalid copy preference "${body.prefer}"`);
    }
    for (const field of ["dry_run", "validate"] as const) {
      if (body[field] !== undefined && typeof body[field] !== "boolean") {
        throw new ValidationError(`${field} must be a boolean`);
      }
    }
    return Scope.of(from.project, from.env);
  }

  private static async readBody(c: Context): Promise<CopyRequest> {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      throw new ValidationError("invalid JSON body");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new ValidationError("invalid body: want source_url and source_api_key");
    }
    return body as CopyRequest;
  }

  private static validateOptions(body: CopyRequest): void {
    if (typeof body.source_url !== "string") {
      throw new ValidationError("source_url is required");
    }
    if (typeof body.source_api_key !== "string") {
      throw new ValidationError("source_api_key is required");
    }
    if (body.mode !== undefined && body.mode !== "merge" && body.mode !== "replace") {
      throw new ValidationError(`invalid copy mode "${body.mode}"`);
    }
    if (body.prefer !== undefined && body.prefer !== "local" && body.prefer !== "remote") {
      throw new ValidationError(`invalid copy preference "${body.prefer}"`);
    }
    for (const field of ["with_keys", "dry_run", "validate"] as const) {
      if (body[field] !== undefined && typeof body[field] !== "boolean") {
        throw new ValidationError(`${field} must be a boolean`);
      }
    }
  }
}
