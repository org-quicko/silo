import type { Context } from "hono";
import { Claims } from "@silo/shared/claims";
import path from "path";
import { Service } from "../../core/service/service";
import { ValidationError } from "@silo/shared/validation-error";
import { RouteAuth } from "../auth/route-auth";
import { MimeUtils } from "../../core/media/mime-utils";

export class MediaRoutes {
  static register(app: any, svc: Service) {
    // 1. Upload media
    app.post("/api/media", async (c: Context) => {
      RouteAuth.requireClaim(c, Claims.MediaCreate);

      const body = await c.req.parseBody();
      const file = body["file"];
      if (!file || !(file instanceof File)) {
        throw new ValidationError("missing or invalid 'file' field in multipart request");
      }

      const arrayBuffer = await file.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);

      const meta = await svc.saveMedia(file.name, uint8Array, file.type);
      return c.json(meta, 201);
    });

    // 2. List media
    app.get("/api/media", async (c: Context) => {
      RouteAuth.requireClaim(c, Claims.MediaRead);
      const list = await svc.listMedia();
      return c.json({ items: list });
    });

    // 3. Delete media
    app.delete("/api/media/:filename", async (c: Context) => {
      RouteAuth.requireClaim(c, Claims.MediaDelete);

      const filename = c.req.param("filename") || "";
      await svc.deleteMedia(filename);
      return c.body(null, 204);
    });

    // 4. Public route to serve media files via BlobStorage
    app.get("/media/:filename", async (c: Context) => {
      const filename = c.req.param("filename") || "";
      if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
        return c.text("invalid filename", 400);
      }
      const media = await svc.getMedia(filename);
      if (media) {
        const contentType = media.contentType || MimeUtils.lookup(filename);
        return new Response(media.data, {
          headers: {
            "Content-Type": contentType,
            "Cache-Control": "public, max-age=31536000, immutable",
          },
        });
      }
      return c.text("not found", 404);
    });
  }
}
