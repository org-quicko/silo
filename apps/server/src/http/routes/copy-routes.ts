import type { Context } from "hono";
import { Claims } from "@silo/shared/claims";
import type { SiloService } from "../../core/services/silo-service";
import { ValidationError } from "@silo/shared/validation-error";
import { HttpSiloClient } from "../../adapters/http/http-silo-client";
import { Scope } from "../../core/domain/scope";
import { EntryUtils } from "../../core/domain/entry-utils";
import { RouteAuth } from "../auth/route-auth";
import type { CopyRequest } from "./copy-request";
import type { ScopeCopyRequest } from "./scope-copy-request";
import type { ScopeCopySelection } from "../routes/scope-copy-request";

export class CopyRoutes {
  static register(app: any, service: SiloService) {
    CopyRoutes.registerScopeCopy(app, service);

    app.post("/api/copy", async (c: Context) => {
      const key = RouteAuth.requireClaim(c, Claims.TransferCopy);
      // A copy is an import of a remote instance's full archive, so it needs
      // the same instance-wide write authority a local import does.
      RouteAuth.requireInstanceWide(c, "copy", Claims.TransferWritePermissions);
      // D24: a whole-instance copy pulls and loads the source's media, so it
      // needs the media claims a local import needs. The scoped copy below
      // does not — it touches no media at all (D22).
      RouteAuth.requireClaim(c, Claims.MediaCreate);
      const body = await CopyRoutes.readBody(c);
      CopyRoutes.validateOptions(body);
      if (body.mode === "replace") {
        RouteAuth.requireInstanceWide(c, 'a copy in "replace" mode', Claims.TransferReplacePermissions);
        RouteAuth.requireClaim(c, Claims.MediaDelete);
      }
      if (body.with_keys === true) RouteAuth.requireClaim(c, Claims.KeysImport);

      const source = new HttpSiloClient(body.source_url, body.source_api_key);
      // Streamed end to end: the source streams its export, and this loads
      // from that stream rather than reading it whole first, so a copy costs
      // one chunk of memory instead of the source's whole media library.
      const archive = await source.exportArchiveStream(body.with_keys === true);
      const result = await service.transfer.importTarGzStream(archive, {
        mode: body.mode,
        dryRun: body.dry_run,
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
  private static registerScopeCopy(app: any, service: SiloService): void {
    const handler = async (c: Context) => {
      const to = RouteAuth.getScope(c);
      const body = await CopyRoutes.readScopeBody(c);
      const from = CopyRoutes.validateScopeOptions(body);

      const mode = body.mode || "merge";
      CopyRoutes.requireScopeCopyAuthority(c, from, to, body.selection, mode);
      const scopeCopyPreview = CopyRoutes.previewOptions(c, to, body.selection, body);

      const result = await service.transfer.copyScope(from, to, {
        mode,
        dryRun: body.dry_run,
        prefer: body.prefer,
        selection: body.selection?.map((item) => ({ collection: item.collection, entryIds: item.entry_ids })),
        scopeCopyPreview,
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
    for (const field of ["dry_run"] as const) {
      if (body[field] !== undefined && typeof body[field] !== "boolean") {
        throw new ValidationError(`${field} must be a boolean`);
      }
    }
    for (const field of ["detail_offset", "detail_limit"] as const) {
      const value = body[field];
      if (value !== undefined && (!Number.isInteger(value) || value < 0 || (field === "detail_limit" && value === 0))) {
        throw new ValidationError(`${field} must be a positive integer`);
      }
    }
    if ((body.detail_offset !== undefined || body.detail_limit !== undefined) && body.dry_run !== true) {
      throw new ValidationError("preview detail is available only with dry_run: true");
    }
    CopyRoutes.validateSelection(body.selection, body.mode);
    return Scope.of(from.project, from.env);
  }

  /** Validate before any storage read or write, so a malformed scope never partially copies. */
  private static validateSelection(selection: unknown, mode: ScopeCopyRequest["mode"]): asserts selection is ScopeCopySelection[] | undefined {
    if (selection === undefined) return;
    if (!Array.isArray(selection) || selection.length === 0) {
      throw new ValidationError("selection must be a non-empty array");
    }
    const collections = new Set<string>();
    let hasEntrySubset = false;
    for (const item of selection) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new ValidationError("each selection item must name a collection");
      }
      const choice = item as ScopeCopySelection;
      if (typeof choice.collection !== "string" || !Claims.isCollectionName(choice.collection) || choice.collection.startsWith("_")) {
        throw new ValidationError(`invalid selected collection "${String(choice.collection)}"`);
      }
      if (collections.has(choice.collection)) {
        throw new ValidationError(`duplicate selected collection "${choice.collection}"`);
      }
      collections.add(choice.collection);
      if (choice.entry_ids !== undefined) {
        hasEntrySubset = true;
        if (!Array.isArray(choice.entry_ids) || choice.entry_ids.length === 0 || choice.entry_ids.some((id) => typeof id !== "string" || id.length === 0)) {
          throw new ValidationError(`entry_ids for "${choice.collection}" must be a non-empty string array`);
        }
        if (new Set(choice.entry_ids).size !== choice.entry_ids.length) {
          throw new ValidationError(`duplicate selected entry id in collection "${choice.collection}"`);
        }
        for (const id of choice.entry_ids) EntryUtils.assertSafeSegment(id, "selected entry id");
      }
    }
    if (hasEntrySubset && mode === "replace") {
      throw new ValidationError("replace mode cannot copy a selected entry subset; use merge instead");
    }
  }

  /** Details are dry-run only; destination ids are withheld unless their scope is readable. */
  private static previewOptions(
    c: Context,
    to: Scope,
    selection: ScopeCopySelection[] | undefined,
    body: ScopeCopyRequest,
  ): { offset: number; limit: number; includeDestinationDetails: boolean } | undefined {
    if (body.dry_run !== true) return undefined;
    const offset = body.detail_offset ?? 0;
    const limit = Math.min(body.detail_limit ?? 25, 100);
    const key = RouteAuth.requireKey(c);
    const collections = selection?.map((item) => item.collection) ?? ["*"];
    const includeDestinationDetails = collections.every((collection) =>
      Claims.ScopeCopyReadPermissions.every((permission) =>
        Claims.has(key.claims, Claims.collection(to.project, to.env, collection, permission)),
      ),
    );
    return { offset, limit, includeDestinationDetails };
  }

  private static requireScopeCopyAuthority(
    c: Context,
    from: Scope,
    to: Scope,
    selection: ScopeCopySelection[] | undefined,
    mode: "merge" | "replace",
  ): void {
    if (!selection) {
      RouteAuth.requireScopeWide(c, "a scope copy's source", from.project, from.env, Claims.ScopeCopyReadPermissions);
      RouteAuth.requireScopeWide(c, "a scope copy's destination", to.project, to.env, Claims.ScopeCopyWritePermissions);
      if (mode === "replace") {
        RouteAuth.requireScopeWide(c, 'a scope copy in "replace" mode', to.project, to.env, Claims.ScopeCopyReplacePermissions);
      }
      return;
    }
    for (const item of selection) {
      for (const permission of Claims.ScopeCopyReadPermissions) {
        RouteAuth.requireCollectionClaim(c, from.project, from.env, item.collection, permission);
      }
      for (const permission of Claims.ScopeCopyWritePermissions) {
        RouteAuth.requireCollectionClaim(c, to.project, to.env, item.collection, permission);
      }
      if (mode === "replace") {
        for (const permission of Claims.ScopeCopyReplacePermissions) {
          RouteAuth.requireCollectionClaim(c, to.project, to.env, item.collection, permission);
        }
      }
    }
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
    for (const field of ["with_keys", "dry_run"] as const) {
      if (body[field] !== undefined && typeof body[field] !== "boolean") {
        throw new ValidationError(`${field} must be a boolean`);
      }
    }
  }
}
