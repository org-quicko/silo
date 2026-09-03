import type { Context } from "hono";
import { Claims } from "@silo/shared/claims";
import { SiloService } from "../../core/services/silo-service";
import { ValidationError } from "@silo/shared/validation-error";
import { RouteAuth } from "../auth/route-auth";
import { MediaInUseError } from "../../core/errors/media-in-use-error";
import { MimeUtils } from "../../core/media/mime-utils";
import { MediaDeleteBatch } from "./media-delete-batch";
import { MediaInUseDetails } from "./media-in-use-details";

export class MediaRoutes {
  /** Caps `POST /api/media/delete` (D48). Each id takes its own write lock in
   *  its own turn, so an unbounded batch is an amplification an operator
   *  should not be able to ask for in one request. */
  private static readonly BulkDeleteCap = 100;

  static register(app: any, service: SiloService) {
    app.post("/api/media/reconcile", async (c: Context) => {
      // Reconcile adopts records and prunes them, so it asks for both halves
      // rather than hiding a delete behind a read-shaped claim.
      RouteAuth.requireClaim(c, Claims.MediaCreate);
      RouteAuth.requireClaim(c, Claims.MediaDelete);
      return c.json(await service.media.reconcile());
    });

    // ---- Assets ----

    // Registered before /api/media/:id, like MediaFolderRoutes' routes are,
    // so "delete" and "purge" are never read as an asset id.
    app.post("/api/media/delete", async (c: Context) => {
      RouteAuth.requireClaim(c, Claims.MediaDelete);
      const body = await c.req.json();
      const ids = MediaRoutes.parseBulkIds(body?.ids);
      const force = body?.force === true;

      if (force) {
        await RouteAuth.requireForcedMediaDelete(c, "bulk media delete", service.media, ids);
      }

      const batch = await MediaDeleteBatch.run(service, ids, force, (id, caught) =>
        MediaInUseDetails.build(c, service, id, caught)
      );

      // Always 200: the request itself succeeded, and each id's outcome is
      // data the caller reads out of the body — including the referrers a
      // 409 would have carried, which a bare status code cannot.
      return c.json(batch, 200);
    });

    app.post("/api/media/purge", async (c: Context) => {
      RouteAuth.requireClaim(c, Claims.MediaDelete);
      const body = await c.req.json();
      // A typed confirmation is the cheapest insurance against a stray or
      // replayed request emptying a library: there is no undo.
      if (body?.confirm !== "purge") {
        throw new ValidationError('purge requires {"confirm": "purge"}');
      }
      const force = body?.force === true;

      const result = await service.media.purge(
        force,
        (ids) => RouteAuth.requireForcedMediaDelete(c, "purge", service.media, ids),
        (ids, forced) =>
          MediaDeleteBatch.run(service, ids, forced, (id, caught) => MediaInUseDetails.build(c, service, id, caught))
      );

      return c.json(result, 200);
    });

    app.post("/api/media", async (c: Context) => {
      RouteAuth.requireClaim(c, Claims.MediaCreate);

      const body = await c.req.parseBody();
      const file = body["file"];
      if (!file || !(file instanceof File)) {
        throw new ValidationError("missing or invalid 'file' field in multipart request");
      }
      const folder = typeof body["folder"] === "string" ? body["folder"] : undefined;

      const bytes = new Uint8Array(await file.arrayBuffer());
      const asset = await service.media.save(file.name, bytes, file.type, folder);
      return c.json(asset, 201);
    });

    app.get("/api/media", async (c: Context) => {
      RouteAuth.requireClaim(c, Claims.MediaRead);
      const q = c.req.query();
      const response = await service.media.list({
        text: q.q,
        folder: q.folder,
        recursive: q.recursive === "true",
        type: q.type,
        ext: q.ext,
        tag: q.tag,
        modifiedAfter: q.modified_after,
        modifiedBefore: q.modified_before,
        limit: q.limit === undefined ? undefined : Number(q.limit),
        offset: q.offset === undefined ? undefined : Number(q.offset),
        sort: q.sort,
      });
      return c.json({
        items: response.items,
        total: response.total,
        limit: response.limit,
        offset: response.offset,
      });
    });

    // Registered before /api/media/:id for the same reason "delete" and
    // "purge" are — it must never be read as an asset id.
    app.get("/api/media/extensions", async (c: Context) => {
      RouteAuth.requireClaim(c, Claims.MediaRead);
      return c.json({ items: await service.media.listExtensions() });
    });

    app.get("/api/media/:id", async (c: Context) => {
      RouteAuth.requireClaim(c, Claims.MediaRead);
      return c.json(await service.media.get(c.req.param("id") || ""));
    });

    app.get("/api/media/:id/usages", async (c: Context) => {
      RouteAuth.requireClaim(c, Claims.MediaRead);
      const response = await service.media.usages(
        c.req.param("id") || "",
        {
          limit: c.req.query("limit") === undefined ? undefined : Number(c.req.query("limit")),
          offset: c.req.query("offset") === undefined ? undefined : Number(c.req.query("offset")),
        },
        MediaInUseDetails.readableBy(c)
      );
      return c.json({
        items: response.items,
        total: response.total,
        visible: response.visible,
        visible_capped: response.visibleCapped,
      });
    });

    // Rename, move, retag. `media:create` rather than a new claim: it is the
    // claim that already governs putting a file into the library, and where
    // it sits is the same kind of statement as what it is called.
    app.patch("/api/media/:id", async (c: Context) => {
      RouteAuth.requireClaim(c, Claims.MediaCreate);
      const body = await c.req.json();
      return c.json(
        await service.media.update(c.req.param("id") || "", {
          filename: body?.filename,
          folder: body?.folder,
          tags: body?.tags,
        })
      );
    });

    app.delete("/api/media/:id", async (c: Context) => {
      RouteAuth.requireClaim(c, Claims.MediaDelete);
      const id = c.req.param("id") || "";
      // Strict: only the literal string "true" opts in (D48).
      const force = c.req.query("force") === "true";
      if (force) {
        // D49: `media:delete` alone is no longer enough. Additionally
        // requires `entries:update` on every scope this asset is actually
        // referenced from — see `RouteAuth.requireForcedMediaDelete`.
        await RouteAuth.requireForcedMediaDelete(c, "media delete", service.media, [id]);
      }
      try {
        await service.media.delete(id, { force });
      } catch (caught) {
        if (caught instanceof MediaInUseError) {
          return c.json(
            {
              error: {
                code: "media_in_use",
                message: caught.message,
                details: await MediaInUseDetails.build(c, service, id, caught),
              },
            },
            409
          );
        }
        throw caught;
      }
      return c.body(null, 204);
    });

    // ---- Public streaming ----
    // By catalog id, so the URL survives a rename. A pre-D23 `/media/<key>`
    // still resolves while an instance is being backfilled.

    app.get("/media/:idOrKey", async (c: Context) => {
      const idOrKey = c.req.param("idOrKey") || "";
      if (idOrKey.includes("..") || idOrKey.includes("/") || idOrKey.includes("\\")) {
        return c.text("invalid media identifier", 400);
      }

      const media = await service.media.bytes(idOrKey);
      if (!media) {
        return c.text("not found", 404);
      }

      const headers: Record<string, string> = {
        "Content-Type": media.contentType || MimeUtils.lookup(media.filename || idOrKey),
        // Not `immutable` any more: an asset is addressed by a stable id, and
        // what that id points at can be replaced. The hash gives revalidation
        // something exact to compare (D23).
        "Cache-Control": "public, max-age=3600",
      };
      if (media.hash) {
        headers["ETag"] = `"${media.hash}"`;
        if (c.req.header("if-none-match") === `"${media.hash}"`) {
          return new Response(null, { status: 304, headers });
        }
      }
      if (media.filename) {
        headers["Content-Disposition"] =
          `inline; filename*=UTF-8''${encodeURIComponent(media.filename)}`;
      }
      return new Response(media.data, { headers });
    });
  }

  /** Validates the bulk delete body's `ids`: a non-empty array of non-empty
   *  strings, capped at {@link BulkDeleteCap}, deduplicated preserving
   *  first-seen order — `{ids:["x","x"]}` deletes `x` once rather than
   *  reporting a spurious `not_found` for the id its own first pass just
   *  removed. */
  private static parseBulkIds(raw: unknown): string[] {
    if (!Array.isArray(raw) || raw.length === 0) {
      throw new ValidationError('"ids" must be a non-empty array of strings');
    }
    if (raw.length > MediaRoutes.BulkDeleteCap) {
      throw new ValidationError(`"ids" cannot exceed ${MediaRoutes.BulkDeleteCap} per request`);
    }
    const ids = raw.map((id, index) => {
      if (typeof id !== "string" || !id.trim()) {
        throw new ValidationError(`"ids[${index}]" must be a non-empty string`);
      }
      return id;
    });
    return [...new Set(ids)];
  }
}
