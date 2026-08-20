import type { Context } from "hono";
import { Claims } from "@silo/shared/claims";
import { Service } from "../../core/service/service";
import { ValidationError } from "@silo/shared/validation-error";
import { RouteAuth } from "../auth/route-auth";
import { MediaInUseError } from "../../core/errors/media-in-use-error";
import { MimeUtils } from "../../core/media/mime-utils";

export class MediaRoutes {
  /** How many referrers a 409 body enumerates before it just reports a count. */
  private static readonly UsageSample = 20;

  static register(app: any, svc: Service) {
    // ---- Folders ----
    // Registered before /api/media/:id so "folders" is never read as an id.

    app.get("/api/media/folders", async (c: Context) => {
      RouteAuth.requireClaim(c, Claims.MediaRead);
      return c.json({ items: await svc.listMediaFolders() });
    });

    app.post("/api/media/folders", async (c: Context) => {
      RouteAuth.requireClaim(c, Claims.MediaCreate);
      const body = await c.req.json();
      const path = await svc.createMediaFolder(body?.path);
      return c.json({ path }, 201);
    });

    app.delete("/api/media/folders", async (c: Context) => {
      RouteAuth.requireClaim(c, Claims.MediaDelete);
      const path = c.req.query("path");
      await svc.deleteMediaFolder(path);
      return c.body(null, 204);
    });

    app.post("/api/media/reconcile", async (c: Context) => {
      // Reconcile adopts records and prunes them, so it asks for both halves
      // rather than hiding a delete behind a read-shaped claim.
      RouteAuth.requireClaim(c, Claims.MediaCreate);
      RouteAuth.requireClaim(c, Claims.MediaDelete);
      return c.json(await svc.reconcileMedia());
    });

    // ---- Assets ----

    app.post("/api/media", async (c: Context) => {
      RouteAuth.requireClaim(c, Claims.MediaCreate);

      const body = await c.req.parseBody();
      const file = body["file"];
      if (!file || !(file instanceof File)) {
        throw new ValidationError("missing or invalid 'file' field in multipart request");
      }
      const folder = typeof body["folder"] === "string" ? body["folder"] : undefined;

      const bytes = new Uint8Array(await file.arrayBuffer());
      const asset = await svc.saveMedia(file.name, bytes, file.type, folder);
      return c.json(asset, 201);
    });

    app.get("/api/media", async (c: Context) => {
      RouteAuth.requireClaim(c, Claims.MediaRead);
      const q = c.req.query();
      const res = await svc.listMedia({
        q: q.q,
        folder: q.folder,
        recursive: q.recursive === "true",
        type: q.type,
        tag: q.tag,
        limit: q.limit === undefined ? undefined : Number(q.limit),
        offset: q.offset === undefined ? undefined : Number(q.offset),
        sort: q.sort,
      });
      return c.json({
        items: res.items,
        total: res.total,
        limit: res.limit,
        offset: res.offset,
      });
    });

    app.get("/api/media/:id", async (c: Context) => {
      RouteAuth.requireClaim(c, Claims.MediaRead);
      return c.json(await svc.getMediaAsset(c.req.param("id") || ""));
    });

    app.get("/api/media/:id/usages", async (c: Context) => {
      RouteAuth.requireClaim(c, Claims.MediaRead);
      const res = await svc.listMediaUsages(
        c.req.param("id") || "",
        {
          limit: c.req.query("limit") === undefined ? undefined : Number(c.req.query("limit")),
          offset: c.req.query("offset") === undefined ? undefined : Number(c.req.query("offset")),
        },
        MediaRoutes.readableBy(c)
      );
      return c.json({ items: res.items, total: res.total, visible: res.visible });
    });

    // Rename, move, retag. `media:create` rather than a new claim: it is the
    // claim that already governs putting a file into the library, and where
    // it sits is the same kind of statement as what it is called.
    app.patch("/api/media/:id", async (c: Context) => {
      RouteAuth.requireClaim(c, Claims.MediaCreate);
      const body = await c.req.json();
      return c.json(
        await svc.updateMediaAsset(c.req.param("id") || "", {
          filename: body?.filename,
          folder: body?.folder,
          tags: body?.tags,
        })
      );
    });

    app.delete("/api/media/:id", async (c: Context) => {
      RouteAuth.requireClaim(c, Claims.MediaDelete);
      const id = c.req.param("id") || "";
      try {
        await svc.deleteMedia(id);
      } catch (err) {
        if (err instanceof MediaInUseError) {
          // The total is the true one; the rows are only those this key may
          // read. A project-confined key learns that the file is in use and
          // how widely, without learning which other projects hold it (§8.1).
          const usage = await svc.listMediaUsages(
            id,
            { limit: MediaRoutes.UsageSample },
            MediaRoutes.readableBy(c)
          );
          return c.json(
            {
              error: {
                code: "media_in_use",
                message: err.message,
                details: {
                  usage_count: err.usageCount,
                  visible_count: usage.visible,
                  referrers: usage.items,
                },
              },
            },
            409
          );
        }
        throw err;
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

      const media = await svc.getMedia(idOrKey);
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

  /**
   * Whether the calling key may see a referrer at all. Anonymous callers get
   * no enumeration — the count alone is public enough for a delete they were
   * refused.
   */
  private static readableBy(c: Context) {
    return (project: string, env: string, collection: string): boolean =>
      RouteAuth.canReadEntries(c, project, env, collection);
  }
}
