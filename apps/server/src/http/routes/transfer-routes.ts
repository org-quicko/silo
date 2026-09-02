import type { Context } from "hono";
import { Claims } from "@silo/shared/claims";
import type { SiloService } from "../../core/services/silo-service";
import { ValidationError } from "@silo/shared/validation-error";
import { RouteAuth } from "../auth/route-auth";

export class TransferRoutes {
  static register(app: any, service: SiloService) {
    app.get("/api/export", async (c: Context) => {
      RouteAuth.requireClaim(c, Claims.TransferExport);
      RouteAuth.requireInstanceWide(c, "export", Claims.TransferReadPermissions);
      // D24: an archive carries the media library and its catalog, so the
      // caller must independently hold the media permission the operation
      // exercises — the same rule D21 applies to collections, on the one
      // surface D21 deferred.
      RouteAuth.requireClaim(c, Claims.MediaRead);
      const withKeys = c.req.query("with_keys") === "true";
      if (withKeys) RouteAuth.requireClaim(c, Claims.KeysExport);
      // Streamed rather than read into a Buffer: an archive carries the whole
      // media library, so buffering it made the response cost as much memory
      // as the instance holds and failed on a small host instead of merely
      // being slow. The export walk is awaited inside, so a storage or blob
      // error still becomes an error response rather than a truncated body.
      const archive = await service.transfer.exportTarGzStream({ withKeys });

      c.header("Content-Type", "application/gzip");
      c.header("Content-Disposition", 'attachment; filename="silo-export.tar.gz"');
      return c.body(archive);
    });

    app.post("/api/import", async (c: Context) => {
      const key = RouteAuth.requireClaim(c, Claims.TransferImport);
      const mode = c.req.query("mode") as "merge" | "replace" | undefined;
      RouteAuth.requireInstanceWide(c, "import", Claims.TransferWritePermissions);
      RouteAuth.requireClaim(c, Claims.MediaCreate);
      // `replace` drops each archived collection — entries and schema — before
      // writing it back, which `merge` never does, so its two extra
      // permissions are asked for only when it is the mode. An unrecognised
      // mode is not `replace`; `Importer.executeImport` rejects it as a 400.
      if (mode === "replace") {
        RouteAuth.requireInstanceWide(c, 'an import in "replace" mode', Claims.TransferReplacePermissions);
        // Replace clears every blob in the instance before loading.
        RouteAuth.requireClaim(c, Claims.MediaDelete);
      }
      const validate = c.req.query("validate") === "true";
      const dryRun = c.req.query("dry_run") === "true";
      const prefer = c.req.query("prefer") as "local" | "remote" | undefined;

      // Both branches hand the importer a stream rather than a `Buffer`. An
      // archive carries every media byte, so reading the upload whole cost as
      // much memory as the source instance's library.
      let archive: ReadableStream<Uint8Array>;
      const contentType = c.req.header("Content-Type") || "";

      if (contentType.startsWith("multipart/form-data")) {
        // `parseBody` reads the form to find the part, so this branch is still
        // bounded by whatever the runtime does with a large upload — taking
        // the part's own stream drops the second full copy on top of it, and
        // is as far as a multipart body goes without a streaming parser. The
        // admin sends the archive as a raw body for exactly this reason; the
        // branch stays for `curl -F` and anything else already posting a form.
        const body = await c.req.parseBody();
        const file = body.file as any;
        if (!file || typeof file.stream !== "function") {
          throw new ValidationError("missing file in form data");
        }
        archive = file.stream();
      } else {
        const raw = c.req.raw.body;
        if (!raw) {
          throw new ValidationError("missing archive in request body");
        }
        archive = raw;
      }

      const response = await service.transfer.importTarGzStream(archive, {
        mode,
        validate,
        dryRun,
        prefer,
        allowKeys: Claims.has(key.claims, Claims.KeysImport),
      });

      return c.json(response);
    });
  }
}
