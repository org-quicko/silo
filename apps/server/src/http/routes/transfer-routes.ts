import type { Context } from "hono";
import { Claims } from "@silo/shared/claims";
import type { SiloService } from "../../core/services/silo-service";
import { ValidationError } from "@silo/shared/validation-error";
import { ImportGrants } from "../../core/transfer/import-grants";
import type { ImportProgress } from "../../core/transfer/import-progress";
import { MediaModes } from "../../core/transfer/media-mode";
import { RouteAuth } from "../auth/route-auth";
import { TransferAuth } from "../auth/transfer-auth";
import { ProgressStream } from "./progress-stream";
import { TransferQuery } from "./transfer-query";

export class TransferRoutes {
  static register(app: any, service: SiloService) {
    app.get("/api/export", async (c: Context) => {
      RouteAuth.requireClaim(c, Claims.TransferExport);
      const selection = TransferQuery.selection(c);
      const media = TransferQuery.media(c, selection);
      TransferAuth.require(c, "export", selection, Claims.TransferReadPermissions);
      // D24 additionally required `media:read` here, on the rule that an
      // archive carries the media library and the caller must independently
      // hold what the operation exercises. D58 retired that claim: reading the
      // library needs none, so there is nothing left to require. What the
      // archive discloses about media is what `GET /api/media` already
      // discloses to anyone who asks.
      const withKeys = c.req.query("with_keys") === "true";
      if (withKeys) {
        RouteAuth.requireClaim(c, Claims.KeysExport);
        // Keys are instance-global, so an archive carrying them confers
        // instance-wide authority however narrow its content selection is.
        RouteAuth.requireInstanceWide(c, "an export with keys", Claims.TransferReadPermissions);
      }

      // Produced as it is walked: the response begins immediately, rather than
      // after a walk that on a real library takes longer than a connection is
      // allowed to stay quiet (§7.1, §10.3). The cost is that a storage or blob
      // failure now truncates the body instead of becoming an error status —
      // and a truncated archive fails its own gzip check at the far end, so it
      // cannot half-import.
      const archive = service.transfer.exportTarGzStream({ withKeys, include: selection, media });

      c.header("Content-Type", "application/gzip");
      c.header("Content-Disposition", 'attachment; filename="silo-export.tar.gz"');
      return c.body(archive);
    });

    app.post("/api/import", async (c: Context) => {
      const key = RouteAuth.requireClaim(c, Claims.TransferImport);
      const mode = c.req.query("mode") as "merge" | "replace" | undefined;
      const selection = TransferQuery.selection(c);
      const media = TransferQuery.media(c, selection);
      TransferAuth.require(c, "import", selection, Claims.TransferWritePermissions);
      // Nothing is created in the library when the archive's bytes are being
      // ignored, so the claim is asked for up front only when they are not.
      // The archive's `_system` half is judged once it is unpacked, against
      // the same claims (`ImportSystemGate`, D84): catalog rows still need
      // `media:create` with `media=none`, and variables need the reach their
      // own routes ask for.
      if (media !== MediaModes.None) RouteAuth.requireClaim(c, Claims.MediaCreate);
      // `replace` drops each archived collection — entries and schema — before
      // writing it back, which `merge` never does, so its two extra
      // permissions are asked for only when it is the mode. An unrecognised
      // mode is not `replace`; `Importer.executeImport` rejects it as a 400.
      if (mode === "replace") {
        TransferAuth.require(c, 'an import in "replace" mode', selection, Claims.TransferReplacePermissions);
        // Replace clears the blobs an archive is authoritative for. Only a
        // whole-library archive is authoritative for all of them (§7.7), but
        // the claim is asked for whenever any blob may be removed.
        if (media !== MediaModes.None) RouteAuth.requireClaim(c, Claims.MediaDelete);
      }
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

      const load = (onProgress?: (progress: ImportProgress) => void) =>
        service.transfer.importTarGzStream(archive, {
          mode,
          dryRun,
          prefer,
          include: selection,
          media,
          onProgress,
          grants: ImportGrants.fromClaims(key.claims),
        });

      // An import says nothing while it extracts and writes, which on a
      // connection that closes when it goes quiet is exactly how a succeeding
      // import looks like a failing one (§7.8). Opt-in, so nothing already
      // reading the JSON body has to change.
      if (ProgressStream.wanted(c)) return ProgressStream.respond(c, load);
      return c.json(await load());
    });
  }
}
