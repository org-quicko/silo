import type { Context } from "hono";
import { Claims } from "@silo/shared/claims";
import { ValidationError } from "@silo/shared/validation-error";
import { NotFoundError } from "../../core/errors/not-found-error";
import type { SiloService } from "../../core/services/silo-service";
import { TrashKinds } from "../../core/trash/trash-kind";
import type { TrashView } from "../../core/trash/trash-view";
import { RouteAuth } from "../auth/route-auth";
import { TrashRestoreAuthority } from "../auth/trash-restore-authority";
import { TrashVisibility } from "../auth/trash-visibility";

/**
 * The trash (D91): what a delete left behind, and the two ways out of it.
 *
 * Reading needs no claim of its own — each receipt is filtered by the read
 * claim its origin already required (`TrashVisibility`). Restoring asks for the
 * write claims at the destination (`TrashRestoreAuthority`). Only purging has a
 * claim, and only `root` carries it.
 */
export class TrashRoutes {
  static register(app: any, service: SiloService) {
    app.get("/api/trash", async (c: Context) => {
      RouteAuth.requireKey(c);
      const page = await service.trash.list({
        kind: TrashRoutes.kind(c.req.query("kind")),
        project: c.req.query("project") || undefined,
        env: c.req.query("env") || undefined,
        collection: c.req.query("collection") || undefined,
        deleted_after: c.req.query("deleted_after") || undefined,
        deleted_before: c.req.query("deleted_before") || undefined,
        q: c.req.query("q") || undefined,
        limit: TrashRoutes.number(c.req.query("limit"), "limit"),
        offset: TrashRoutes.number(c.req.query("offset"), "offset"),
      });
      const items = TrashVisibility.filter(c, page.items);
      // `total` counts what this caller may see, not what the trash holds: a
      // page of four with a total of nine would be a disclosure by arithmetic.
      return c.json({ ...page, items, total: page.total - (page.items.length - items.length) });
    });

    // Before `/api/trash/:id`, so "purge" is never read as a receipt id.
    app.post("/api/trash/purge", async (c: Context) => {
      RouteAuth.requireClaim(c, Claims.TrashPurge);
      const body = await c.req.json().catch(() => null);
      if (body?.confirm !== "empty") {
        throw new ValidationError('emptying the trash requires {"confirm": "empty"}');
      }
      return c.json(await service.trash.empty());
    });

    app.get("/api/trash/:id", async (c: Context) => {
      return c.json(await TrashRoutes.visible(c, service));
    });

    app.get("/api/trash/:id/items", async (c: Context) => {
      await TrashRoutes.visible(c, service);
      const page = await service.trash.items(c.req.param("id") || "", {
        limit: TrashRoutes.number(c.req.query("limit"), "limit"),
        offset: TrashRoutes.number(c.req.query("offset"), "offset"),
      });
      return c.json(page);
    });

    app.post("/api/trash/:id/restore", async (c: Context) => {
      const view = await TrashRoutes.visible(c, service);
      TrashRestoreAuthority.require(c, view);
      const body = await c.req.json().catch(() => null);
      const result = await service.trash.restore(view.id, {
        rename: typeof body?.rename === "string" ? body.rename : undefined,
        chain: body?.chain === true,
      });
      return c.json(result);
    });

    app.delete("/api/trash/:id", async (c: Context) => {
      RouteAuth.requireClaim(c, Claims.TrashPurge);
      await TrashRoutes.visible(c, service);
      await service.trash.purge(c.req.param("id") || "");
      return c.body(null, 204);
    });
  }

  /** The receipt, or a 404 rather than a 403 for one the caller may not see:
   *  saying "forbidden" would confirm that something was deleted there. */
  private static async visible(c: Context, service: SiloService): Promise<TrashView> {
    RouteAuth.requireKey(c);
    const id = c.req.param("id") || "";
    const view = await service.trash.get(id);
    if (!TrashVisibility.canSee(c, view)) throw new NotFoundError(`trash item "${id}" not found`);
    return view;
  }

  private static kind(raw: string | undefined) {
    if (!raw) return undefined;
    if (!TrashKinds.isKind(raw)) throw new ValidationError(`invalid kind "${raw}"`);
    return raw;
  }

  private static number(raw: string | undefined, name: string): number | undefined {
    if (raw === undefined) return undefined;
    const value = Number.parseInt(raw, 10);
    if (Number.isNaN(value)) throw new ValidationError(`invalid ${name} "${raw}"`);
    return value;
  }
}
