import type { Context } from "hono";
import { Claims } from "@silo/shared/claims";
import type { Service } from "../../core/service/service";
import { ValidationError } from "@silo/shared/validation-error";
import { HttpSiloClient } from "../../adapters/http/http-silo-client";
import { RouteAuth } from "../auth/route-auth";
import type { CopyRequest } from "./copy-request";

export class CopyRoutes {
  static register(app: any, svc: Service) {
    app.post("/api/copy", async (c: Context) => {
      const key = RouteAuth.requireClaim(c, Claims.TransferCopy);
      // A copy is an import of a remote instance's full archive, so it needs
      // the same instance-wide write authority a local import does.
      RouteAuth.requireInstanceWide(c, "copy", Claims.TransferWritePermissions);
      const body = await CopyRoutes.readBody(c);
      CopyRoutes.validateOptions(body);
      if (body.with_keys === true) RouteAuth.requireClaim(c, Claims.KeysImport);

      const source = new HttpSiloClient(body.source_url, body.source_api_key);
      const archive = await source.exportArchive(body.with_keys === true);
      const result = await svc.importTarGz(archive, {
        mode: body.mode,
        dryRun: body.dry_run,
        validate: body.validate,
        prefer: body.prefer,
        allowKeys: Claims.has(key.claims, Claims.KeysImport),
      });

      return c.json(result);
    });
  }

  private static async readBody(c: Context): Promise<CopyRequest> {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      throw new ValidationError("invalid JSON body");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new ValidationError("invalid body: want source_url and source_api_key");
    }
    return body as CopyRequest;
  }

  private static validateOptions(body: CopyRequest): void {
    if (typeof body.source_url !== "string") {
      throw new ValidationError("source_url is required");
    }
    if (typeof body.source_api_key !== "string") {
      throw new ValidationError("source_api_key is required");
    }
    if (body.mode !== undefined && body.mode !== "merge" && body.mode !== "replace") {
      throw new ValidationError(`invalid copy mode "${body.mode}"`);
    }
    if (body.prefer !== undefined && body.prefer !== "local" && body.prefer !== "remote") {
      throw new ValidationError(`invalid copy preference "${body.prefer}"`);
    }
    for (const field of ["with_keys", "dry_run", "validate"] as const) {
      if (body[field] !== undefined && typeof body[field] !== "boolean") {
        throw new ValidationError(`${field} must be a boolean`);
      }
    }
  }
}
