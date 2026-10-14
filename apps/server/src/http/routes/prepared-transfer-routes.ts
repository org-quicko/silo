import type { Context } from "hono";
import { Claims } from "@silo/shared/claims";
import { ValidationError } from "@silo/shared/validation-error";
import { HttpPackageSource } from "../../adapters/http/http-package-source";
import { EntryUtils } from "../../core/domain/entry-utils";
import type { SiloService } from "../../core/services/silo-service";
import { MediaModes } from "../../core/transfer/media-mode";
import type { PreparedTransferPage } from "../../core/transfer/prepared/prepared-transfer-page";
import type { PreparedTransferProgress } from "../../core/transfer/prepared/prepared-transfer-progress";
import { PreparedTransferRequest } from "../../core/transfer/prepared/prepared-transfer-request";
import type { PreparedTransferView } from "../../core/transfer/prepared/prepared-transfer-view";
import { PreparedTransferViews } from "../../core/transfer/prepared/prepared-transfer-views";
import { RouteAuth } from "../auth/route-auth";
import { ProgressStream } from "./progress-stream";

/**
 * `…/envs/{env}/transfers` (D109, D110): the destination half of a transfer
 * from another instance. Prepare pulls, verifies and plans the source's
 * package; the other routes read the plan a page at a time, read one packaged
 * entry, and cancel.
 *
 * Prepare asks for `transfer:copy`, because the server reaches outside itself,
 * plus the env copy's write claims on each collection (D22), the replace
 * claims in replace mode, and `media:create` when media rides. Everything that
 * can be refused is refused before the source is contacted. The other routes
 * answer only the key that prepared the transfer. Both spellings share each
 * handler, as `ProjectsRoutes` explains.
 */
export class PreparedTransferRoutes {
  static register(app: any, service: SiloService): void {
    const prepare = async (c: Context) => {
      const key = RouteAuth.requireClaim(c, Claims.TransferCopy);
      const to = RouteAuth.getScope(c);
      const request = PreparedTransferRequest.parse(await PreparedTransferRoutes.readBody(c));
      for (const { name } of request.selection.collections) {
        const permissions = [
          ...Claims.ScopeCopyWritePermissions,
          ...(request.mode === "replace" ? Claims.ScopeCopyReplacePermissions : []),
        ];
        for (const permission of permissions) RouteAuth.requireCollectionClaim(c, to.project, to.env, name, permission);
      }
      if (request.selection.media === MediaModes.Referenced) RouteAuth.requireClaim(c, Claims.MediaCreate);

      const source = new HttpPackageSource(request.sourceUrl, request.apiKey, request.from, request.packageBody());
      const record = await service.preparedTransfers.begin(key.id, to, request, source.url);
      const run = (report?: (progress: PreparedTransferProgress) => void) =>
        service.preparedTransfers.fill(record, request, source, PreparedTransferRoutes.reveals(c), report);
      // The pull can take as long as the source's media does, which is what
      // a quiet-connection timeout kills (§7.8).
      if (ProgressStream.wanted(c)) return ProgressStream.respond<PreparedTransferView, PreparedTransferProgress>(c, run);
      return c.json(await run(), 201);
    };

    const read = async (c: Context) => {
      const key = RouteAuth.requireClaim(c, Claims.TransferCopy);
      const page = PreparedTransferRoutes.page(c);
      return c.json(await service.preparedTransfers.read(key.id, RouteAuth.getScope(c), c.req.param("id")!, page));
    };

    const entry = async (c: Context) => {
      const key = RouteAuth.requireClaim(c, Claims.TransferCopy);
      const packaged = await service.preparedTransfers.entry(
        key.id,
        RouteAuth.getScope(c),
        c.req.param("id")!,
        c.req.param("collection")!,
        c.req.param("entry")!
      );
      return c.json(EntryUtils.toApiResponse(packaged));
    };

    const cancel = async (c: Context) => {
      const key = RouteAuth.requireClaim(c, Claims.TransferCopy);
      return c.json(await service.preparedTransfers.cancel(key.id, RouteAuth.getScope(c), c.req.param("id")!));
    };

    app.post("/api/projects/:project/environments/:env/transfers", prepare);
    app.post("/api/projects/:project/envs/:env/transfers", prepare);
    app.get("/api/projects/:project/environments/:env/transfers/:id", read);
    app.get("/api/projects/:project/envs/:env/transfers/:id", read);
    app.get("/api/projects/:project/environments/:env/transfers/:id/entries/:collection/:entry", entry);
    app.get("/api/projects/:project/envs/:env/transfers/:id/entries/:collection/:entry", entry);
    app.delete("/api/projects/:project/environments/:env/transfers/:id", cancel);
    app.delete("/api/projects/:project/envs/:env/transfers/:id", cancel);
  }

  /**
   * Whether the caller may see into a destination collection: the env copy's
   * read claims there (D22), as its preview asks before naming a row only the
   * destination holds.
   */
  private static reveals(c: Context): PreparedTransferPage["reveals"] {
    const key = RouteAuth.requireKey(c);
    const to = RouteAuth.getScope(c);
    return (collection) =>
      Claims.ScopeCopyReadPermissions.every((permission) =>
        Claims.has(key.claims, Claims.collection(to.project, to.env, collection, permission))
      );
  }

  /** `detail_offset` and `detail_limit`, as the env copy's preview names them. */
  private static page(c: Context): PreparedTransferPage {
    const read = (name: string, fallback: number, least: number): number => {
      const value = c.req.query(name);
      if (value === undefined) return fallback;
      if (!/^\d+$/.test(value) || Number(value) < least) {
        throw new ValidationError(`${name} must be an integer of at least ${least}`);
      }
      return Number(value);
    };
    return {
      offset: read("detail_offset", 0, 0),
      limit: read("detail_limit", PreparedTransferViews.DefaultLimit, 1),
      reveals: PreparedTransferRoutes.reveals(c),
    };
  }

  private static async readBody(c: Context): Promise<unknown> {
    try {
      return await c.req.json();
    } catch {
      throw new ValidationError("invalid JSON body");
    }
  }
}
