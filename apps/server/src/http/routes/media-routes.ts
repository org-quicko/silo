import type { Context } from "hono";
import { Claims } from "@silo/shared/claims";
import { SiloService } from "../../core/services/silo-service";
import { ValidationError } from "@silo/shared/validation-error";
import { RouteAuth } from "../auth/route-auth";
import { MediaInUseError } from "../../core/errors/media-in-use-error";
import { MediaDeleteStalledError } from "../../core/errors/media-delete-stalled-error";
import { NotFoundError } from "../../core/errors/not-found-error";
import type { MediaUsage } from "../../core/media/media-usage";
import { MimeUtils } from "../../core/media/mime-utils";

export class MediaRoutes {
  /** How many referrers a 409 body enumerates before it just reports a count. */
  private static readonly UsageSample = 20;

  /** Caps `POST /api/media/delete` (D48). Each id takes its own write lock in
   *  its own turn, so an unbounded batch is an amplification an operator
   *  should not be able to ask for in one request. */
  private static readonly BulkDeleteCap = 100;

  static register(app: any, service: SiloService) {
    // ---- Folders ----
    // Registered before /api/media/:id so "folders" is never read as an id.

    app.get("/api/media/folders", async (c: Context) => {
      RouteAuth.requireClaim(c, Claims.MediaRead);
      return c.json({ items: await service.media.listFolders() });
    });

    app.post("/api/media/folders", async (c: Context) => {
      RouteAuth.requireClaim(c, Claims.MediaCreate);
      const body = await c.req.json();
      const path = await service.media.createFolder(body?.path);
      return c.json({ path }, 201);
    });

    app.delete("/api/media/folders", async (c: Context) => {
      RouteAuth.requireClaim(c, Claims.MediaDelete);
      const path = c.req.query("path");
      await service.media.deleteFolder(path);
      return c.body(null, 204);
    });

    app.post("/api/media/reconcile", async (c: Context) => {
      // Reconcile adopts records and prunes them, so it asks for both halves
      // rather than hiding a delete behind a read-shaped claim.
      RouteAuth.requireClaim(c, Claims.MediaCreate);
      RouteAuth.requireClaim(c, Claims.MediaDelete);
      return c.json(await service.media.reconcile());
    });

    // ---- Assets ----

    // Registered before /api/media/:id, like /api/media/folders above, so
    // "delete" is never read as an asset id.
    app.post("/api/media/delete", async (c: Context) => {
      RouteAuth.requireClaim(c, Claims.MediaDelete);
      const body = await c.req.json();
      const ids = MediaRoutes.parseBulkIds(body?.ids);
      const force = body?.force === true;

      const deleted: string[] = [];
      const failed: Array<Record<string, unknown>> = [];

      // Sequential, not Promise.all: each id takes its own write lock in its
      // own turn, so the batch never holds one lock over the whole request.
      for (const id of ids) {
        try {
          await service.media.delete(id, { force });
          deleted.push(id);
        } catch (caught) {
          if (caught instanceof MediaInUseError) {
            failed.push({
              id,
              code: "media_in_use",
              message: caught.message,
              ...(await MediaRoutes.inUseDetails(c, service, id, caught)),
            });
          } else if (caught instanceof NotFoundError) {
            failed.push({ id, code: "not_found", message: caught.message });
          } else if (caught instanceof MediaDeleteStalledError) {
            failed.push({ id, code: "media_delete_stalled", message: caught.message });
          } else if (caught instanceof ValidationError) {
            // A malformed id — "/", "\", a NUL byte, ".", "..", or over the
            // 255-byte segment cap — is a per-id 4xx condition, not a reason
            // to 400 the whole request after earlier ids were already
            // deleted (§8.1).
            failed.push({ id, code: "invalid_id", message: caught.message });
          } else {
            // An error this route does not know how to describe as one id's
            // outcome — propagate rather than folding it silently into the
            // array.
            throw caught;
          }
        }
      }

      // Always 200: the request itself succeeded, and each id's outcome is
      // data the caller reads out of the body — including the referrers a
      // 409 would have carried, which a bare status code cannot.
      return c.json({ deleted, failed }, 200);
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
        tag: q.tag,
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
        MediaRoutes.readableBy(c)
      );
      return c.json({ items: response.items, total: response.total, visible: response.visible });
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
      // Strict: only the literal string "true" opts in (D48). The claim is
      // already instance-global and unscoped, so a holder can already delete
      // any unreferenced file in any project; force's marginal power is
      // breaking references in scopes it cannot read, which is what the 409
      // body's visibility filtering below already governs.
      const force = c.req.query("force") === "true";
      try {
        await service.media.delete(id, { force });
      } catch (caught) {
        if (caught instanceof MediaInUseError) {
          return c.json(
            {
              error: {
                code: "media_in_use",
                message: caught.message,
                details: await MediaRoutes.inUseDetails(c, service, id, caught),
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

  /**
   * Whether the calling key may see a referrer at all. Anonymous callers get
   * no enumeration — the count alone is public enough for a delete they were
   * refused.
   */
  private static readableBy(c: Context) {
    return (project: string, env: string, collection: string): boolean =>
      RouteAuth.canReadEntries(c, project, env, collection);
  }

  /**
   * The claim-filtered "still in use" facts for one id: the true total, the
   * visible one, and the referrers the calling key may read. Shared by the
   * single-delete 409 and the bulk route's per-id failure entry, which carry
   * the same facts in two different envelopes.
   */
  private static async inUseDetails(
    c: Context,
    service: SiloService,
    id: string,
    caught: MediaInUseError
  ): Promise<{ usage_count: number; visible_count: number; referrers: MediaUsage[] }> {
    const usage = await service.media.usages(
      id,
      { limit: MediaRoutes.UsageSample },
      MediaRoutes.readableBy(c)
    );
    return { usage_count: caught.usageCount, visible_count: usage.visible, referrers: usage.items };
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
