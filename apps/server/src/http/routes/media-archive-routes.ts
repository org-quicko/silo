import type { Context } from "hono";
import { MediaDisposition } from "../../core/media/media-disposition";
import { MediaCatalog } from "../../core/media/media-catalog";
import type { SiloService } from "../../core/services/silo-service";
import { RouteAuth } from "../auth/route-auth";
import { ResponseSandbox } from "../response-sandbox";

/** Library stats and bulk downloads (D106). Registered before `/api/media/:id`. */
export class MediaArchiveRoutes {
  static register(app: any, service: SiloService) {
    // No claim, like the listing it totals (D58).
    app.get("/api/media/stats", async (c: Context) => {
      return c.json(await service.media.stats());
    });

    // Any key: the bytes are public, but building an archive costs the server
    // a stream, so an anonymous caller does not get to start one.
    app.post("/api/media/archives", async (c: Context) => {
      RouteAuth.requireKey(c);
      const ticket = await service.media.prepareArchive(await c.req.json().catch(() => null));
      const { plan } = ticket;
      return c.json(
        {
          id: ticket.id,
          expires_at: ticket.expiresAt.toISOString(),
          files: plan.files,
          bytes: plan.bytes,
          parts: plan.parts.map((part, index) => ({
            part: index + 1,
            filename: part.filename,
            files: part.files.length,
            bytes: part.bytes,
            url: `/api/media/archives/${ticket.id}/${index + 1}`,
          })),
          separate: plan.separate.map((file) => ({
            ...file,
            url: `${MediaCatalog.url(file.id)}?download=true`,
          })),
        },
        201
      );
    });

    // No key: a browser follows this as a plain navigation, and the ticket in
    // the path is the credential. A `HEAD` never opens the stream, so it holds
    // no slot.
    app.get("/api/media/archives/:ticket/:part", async (c: Context) => {
      const ticket = c.req.param("ticket") || "";
      const partNumber = Number(c.req.param("part"));
      const part = service.media.archivePart(ticket, partNumber);
      const headers = ResponseSandbox.apply(
        {
          "Content-Type": "application/zip",
          "Content-Disposition": MediaDisposition.header("application/zip", part.filename, { download: true }),
          "Cache-Control": "no-store",
        },
        ResponseSandbox.MediaPolicy
      );
      if (c.req.method === "HEAD") return new Response(null, { headers });
      return new Response(service.media.openArchive(ticket, partNumber).body, { headers });
    });
  }
}
