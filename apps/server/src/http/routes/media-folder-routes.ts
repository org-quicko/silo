import type { Context } from "hono";
import { Claims } from "@silo/shared/claims";
import type { MediaInUseError } from "../../core/errors/media-in-use-error";
import { SiloService } from "../../core/services/silo-service";
import { ValidationError } from "@silo/shared/validation-error";
import { RouteAuth } from "../auth/route-auth";
import { MediaDeleteBatch } from "./media-delete-batch";
import { MediaInUseDetails } from "./media-in-use-details";
import { TrashHeader } from "./trash-header";

/**
 * `/api/media/folders`: list, create, rename/move (D49), and delete —
 * trivially when empty, or `?recursive=true` to take everything inside it
 * with it (D49).
 *
 * Registered before `MediaRoutes`' `/api/media/:id` routes, like
 * `/api/media/delete` and `/api/media/reconcile`, so "folders" is never read
 * as an asset id.
 */
export class MediaFolderRoutes {
  static register(app: any, service: SiloService) {
    app.get("/api/media/folders", async (c: Context) => {
      return c.json({ items: await service.media.listFolders() });
    });

    app.post("/api/media/folders", async (c: Context) => {
      RouteAuth.requireClaim(c, Claims.MediaCreate);
      const body = await c.req.json();
      const path = await service.media.createFolder(body?.path);
      return c.json({ path }, 201);
    });

    // Rename or move. `media:create`, the same claim and reasoning as an
    // asset rename/move: where a thing sits is the same kind of statement as
    // what it is called. A body rather than a path parameter because a
    // folder path contains "/". `merge` (D49) opts into joining an existing
    // `to` instead of refusing on collision — the same claim covers it,
    // since it is still "where this sits", not a new kind of authority.
    app.patch("/api/media/folders", async (c: Context) => {
      RouteAuth.requireClaim(c, Claims.MediaCreate);
      const body = await c.req.json();
      const merge = body?.merge === true;
      const result = await service.media.renameFolder(body?.from, body?.to, { merge });
      return c.json(result, 200);
    });

    // Into the trash unless `permanent`: the folder records and every file that
    // went are one receipt, named in `X-Silo-Trash-Id` (D113).
    app.delete("/api/media/folders", async (c: Context) => {
      RouteAuth.requireClaim(c, Claims.MediaDelete);
      const path = c.req.query("path");
      const force = c.req.query("force") === "true";
      const options = RouteAuth.getDeleteOptions(c);
      const inUseDetails = (id: string, caught: MediaInUseError) =>
        MediaInUseDetails.build(c, service, id, caught);

      if (c.req.query("recursive") !== "true") {
        if (force) {
          // Accepting the flag and silently dropping it is the worst
          // handling available (D32's `--integrity` refusal states the same
          // rule): without `recursive` nothing in this request deletes
          // anything, so there is nothing for `force` to force.
          throw new ValidationError('"force" requires "recursive": without it there is nothing to force');
        }
        // Unchanged default: refuses while anything is inside (D23).
        const receipt = await service.media.deleteFolder(path, options);
        if (receipt) c.header(TrashHeader.Name, receipt);
        return c.body(null, 204);
      }

      const ids = await service.media.folderAssetIds(path);
      if (force) {
        await RouteAuth.requireMediaContentAuthority(c, "recursive folder delete with force", service.media, ids);
      }

      if (service.media.recoverable(options)) {
        const outcome = await service.media.trashFolder(path, ids, { force, ...options });
        const failed: Array<Record<string, unknown>> = [];
        for (const { id, error } of outcome.failed) {
          failed.push(await MediaDeleteBatch.describe(id, error, inUseDetails));
        }
        if (outcome.trashId) c.header(TrashHeader.Name, outcome.trashId);
        return c.json({ deleted: outcome.deleted, failed, folders_deleted: outcome.foldersDeleted }, 200);
      }

      const batch = await MediaDeleteBatch.run(service, ids, force, inUseDetails, options);
      // An asset a delete could not remove means the folder is not actually
      // gone — `not_found` is the one outcome that doesn't, since the asset
      // was already gone before this request touched it.
      const stillOccupied = batch.failed.some((failure) => failure["code"] !== "not_found");
      const foldersDeleted = stillOccupied ? 0 : await service.media.finishFolderDeletion(path);

      return c.json({ ...batch, folders_deleted: foldersDeleted }, 200);
    });
  }
}
