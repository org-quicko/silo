import type { Context } from "hono";
import { Claims } from "@silo/shared/claims";
import fs from "fs/promises";
import path from "path";
import os from "os";
import type { Service } from "../../core/service/service";
import { ValidationError } from "@silo/shared/validation-error";
import { EntryUtils } from "../../core/domain/entry-utils";
import { RouteAuth } from "../auth/route-auth";

export class TransferRoutes {
  static register(app: any, svc: Service) {
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
      const tempFile = path.join(os.tmpdir(), `silo-export-${EntryUtils.newID()}.tar.gz`);

      await svc.exportTarGz(tempFile, {
        withKeys,
      });

      const fileBuffer = await fs.readFile(tempFile);
      await fs.unlink(tempFile);

      c.header("Content-Type", "application/gzip");
      c.header("Content-Disposition", 'attachment; filename="silo-export.tar.gz"');
      return c.body(fileBuffer);
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

      let buffer: Buffer;
      const contentType = c.req.header("Content-Type") || "";

      if (contentType.startsWith("multipart/form-data")) {
        const body = await c.req.parseBody();
        const file = body.file as any;
        if (!file) {
          throw new ValidationError("missing file in form data");
        }
        const arrayBuffer = await file.arrayBuffer();
        buffer = Buffer.from(arrayBuffer);
      } else {
        const arrayBuffer = await c.req.arrayBuffer();
        buffer = Buffer.from(arrayBuffer);
      }

      const res = await svc.importTarGz(buffer, {
        mode,
        validate,
        dryRun,
        prefer,
        allowKeys: Claims.has(key.claims, Claims.KeysImport),
      });

      return c.json(res);
    });
  }
}
