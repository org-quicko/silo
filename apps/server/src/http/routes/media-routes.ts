import type { Context } from "hono";
import { Claims } from "@silo/shared/claims";
import { SiloService } from "../../core/services/silo-service";
import { ValidationError } from "@silo/shared/validation-error";
import { RouteAuth } from "../auth/route-auth";
import { TrashHeader } from "./trash-header";
import { MediaInUseError } from "../../core/errors/media-in-use-error";
import { MimeUtils } from "../../core/media/mime-utils";
import { MediaDisposition } from "../../core/media/media-disposition";
import { ByteRange } from "../../core/media/byte-range";
import { ResponseSandbox } from "../response-sandbox";
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
        await RouteAuth.requireMediaContentAuthority(c, "bulk media delete with force", service.media, ids);
      }

      const batch = await MediaDeleteBatch.run(
        service,
        ids,
        force,
        (id, caught) => MediaInUseDetails.build(c, service, id, caught),
        RouteAuth.getDeleteOptions(c)
      );

      // Always 200: the request itself succeeded, and each id's outcome is
      // data the caller reads out of the body — including the referrers a
      // 409 would have carried, which a bare status code cannot.
      return c.json(batch, 200);
    });

    // Purge asks for both halves (D65), the way reconcile does. `media:delete`
    // because purge is a delete, and `media:purge` on top because both the
    // `write` and the `manage` preset carry the first — so on its own it
    // would mean every integration key that manages its own uploads could
    // empty the whole instance's library in one request. `media:purge` is
    // carried by no preset but `root`.
    app.post("/api/media/purge", async (c: Context) => {
      RouteAuth.requireClaim(c, Claims.MediaDelete);
      RouteAuth.requireClaim(c, Claims.MediaPurge);
      const body = await c.req.json();
      // A typed confirmation is the cheapest insurance against a stray or
      // replayed request emptying a library: there is no undo.
      if (body?.confirm !== "purge") {
        throw new ValidationError('purge requires {"confirm": "purge"}');
      }
      const force = body?.force === true;

      const result = await service.media.purge(
        force,
        (ids) => RouteAuth.requireMediaContentAuthority(c, "purge with force", service.media, ids),
        // Permanent, never parked: a purge is the caller asking for the bytes
        // to be gone, and filling the trash with the whole library would double
        // its footprint to undo a request that already asked for `media:purge`
        // (D91).
        (ids, forced) =>
          MediaDeleteBatch.run(
            service,
            ids,
            forced,
            (id, caught) => MediaInUseDetails.build(c, service, id, caught),
            { actor: RouteAuth.getActor(c), permanent: true }
          )
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

      // `file.type` is deliberately not passed on: the part's declared type is
      // the client's word, and the extension decides what is served (D83).
      const bytes = new Uint8Array(await file.arrayBuffer());
      const asset = await service.media.save(file.name, bytes, folder);
      return c.json(asset, 201);
    });

    app.get("/api/media", async (c: Context) => {
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
      return c.json({ items: await service.media.listExtensions() });
    });

    app.get("/api/media/:id", async (c: Context) => {
      return c.json(await service.media.get(c.req.param("id") || ""));
    });

    app.get("/api/media/:id/usages", async (c: Context) => {
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
    // it sits is the same kind of statement as what it is called. None of it
    // changes what a reference resolves to, which is exactly what separates it
    // from the replace below.
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

    // Swap the bytes behind an asset, keeping its id, its URL and every
    // reference to it (D67). Two asks, the way purge takes two:
    //
    // `media:replace` because `media:create` is carried by the `write` preset,
    // so gating on it would mean every integration key that uploads its own
    // files could also overwrite anybody else's, anywhere in the
    // instance-global library. Unlike `media:purge` it *is* in `manage`:
    // replacing a stale asset is ordinary content work, and pricing it at root
    // would put editors in the account D38 says to use least.
    //
    // Then `entries:update` at every scope that refers to it, the same gate a
    // force delete passes and for a stronger reason — a force resolves a
    // reference to `null` and shows as a broken field, a replace resolves it
    // to a different file and shows as nothing at all. An unreferenced asset
    // reaches nothing and so needs only the first ask; the claim is what
    // covers it, since silo cannot see a reader that holds the URL and no
    // entry.
    //
    // Authority before the body is read: a refusal should not first pay for
    // the upload it is about to reject.
    app.post("/api/media/:id/content", async (c: Context) => {
      RouteAuth.requireClaim(c, Claims.MediaReplace);
      const id = c.req.param("id") || "";
      await RouteAuth.requireMediaContentAuthority(c, "media replace", service.media, [id]);

      const body = await c.req.parseBody();
      const file = body["file"];
      if (!file || !(file instanceof File)) {
        throw new ValidationError("missing or invalid 'file' field in multipart request");
      }

      const bytes = new Uint8Array(await file.arrayBuffer());
      return c.json(await service.media.replaceContent(id, file.name, bytes));
    });

    app.delete("/api/media/:id", async (c: Context) => {
      RouteAuth.requireClaim(c, Claims.MediaDelete);
      const id = c.req.param("id") || "";
      // Strict: only the literal string "true" opts in (D48).
      const force = c.req.query("force") === "true";
      if (force) {
        // D49: `media:delete` alone is no longer enough. Additionally
        // requires `entries:update` on every scope this asset is actually
        // referenced from — see `RouteAuth.requireMediaContentAuthority`.
        await RouteAuth.requireMediaContentAuthority(c, "media delete with force", service.media, [id]);
      }
      try {
        const receipt = await service.media.delete(id, {
          force,
          ...RouteAuth.getDeleteOptions(c),
        });
        if (receipt) c.header(TrashHeader.Name, receipt);
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

      // Opened, not read: the body is a handle the runtime sends as it goes,
      // so a request costs the bytes it asks for and never the whole file
      // held in memory (D80). A `Range` is honoured, which is what lets a
      // browser seek a video without fetching all of it each time.
      const media = await service.media.open(idOrKey, ByteRange.parse(c.req.header("range")));
      if (!media) {
        return c.text("not found", 404);
      }

      // These bytes are somebody's upload served from the origin the admin
      // lives on, so they leave with the two headers that stop a browser
      // treating them as a page here (D83): `nosniff`, a `sandbox` policy, and
      // an `attachment` disposition for anything a browser could execute.
      const contentType = media.contentType || MimeUtils.lookup(media.filename || idOrKey);
      const headers = ResponseSandbox.apply(
        {
          "Content-Type": contentType,
          // Not `immutable` any more: an asset is addressed by a stable id, and
          // what that id points at can be replaced. The hash gives revalidation
          // something exact to compare (D23).
          "Cache-Control": "public, max-age=3600",
          "Accept-Ranges": "bytes",
          "Content-Disposition": MediaDisposition.header(contentType, media.filename),
        },
        ResponseSandbox.MediaPolicy
      );
      if (media.hash) {
        headers["ETag"] = `"${media.hash}"`;
        if (c.req.header("if-none-match") === `"${media.hash}"`) {
          return new Response(null, { status: 304, headers });
        }
      }
      // Always a stream, never a `Blob` handed to the response: measured, the
      // runtime reads a file handle whole per request where it forwards a
      // stream as it goes. The length is stated here since a stream carries
      // none, from the catalog or from the blob when a store answered one.
      const length = media.range
        ? media.range.end - media.range.start + 1
        : media.size ?? (media.body instanceof Blob ? media.body.size : undefined);
      if (length !== undefined) headers["Content-Length"] = String(length);
      const body = media.body instanceof Blob ? media.body.stream() : media.body;

      if (media.range) {
        headers["Content-Range"] =
          `bytes ${media.range.start}-${media.range.end}/${media.size ?? "*"}`;
        return new Response(body, { status: 206, headers });
      }
      return new Response(body, { headers });
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
