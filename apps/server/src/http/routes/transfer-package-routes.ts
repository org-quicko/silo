import type { Context } from "hono";
import { Claims } from "@silo/shared/claims";
import { ValidationError } from "@silo/shared/validation-error";
import type { SiloService } from "../../core/services/silo-service";
import { TransferPackageSelection } from "../../core/transfer/package/transfer-package-selection";
import { RouteAuth } from "../auth/route-auth";

/**
 * `POST /api/projects/{project}/envs/{env}/package` (D108): the source half of
 * a cross-instance transfer. It streams exactly what the body names, and a
 * name that is malformed, unreadable by the key or absent is an error status
 * before the first byte.
 *
 * It asks for what a narrowed export of the same collections asks for (D74):
 * `transfer:export` and read on each one. Both spellings share one handler,
 * as `ProjectsRoutes` explains.
 */
export class TransferPackageRoutes {
  static register(app: any, service: SiloService): void {
    const handler = async (c: Context) => {
      RouteAuth.requireClaim(c, Claims.TransferExport);
      const scope = RouteAuth.getScope(c);
      const selection = TransferPackageSelection.parse(scope, await TransferPackageRoutes.readBody(c));
      for (const collection of selection.collections) {
        for (const permission of Claims.TransferReadPermissions) {
          RouteAuth.requireCollectionClaim(c, scope.project, scope.env, collection.name, permission);
        }
      }

      const body = await service.transfer.package(selection);
      c.header("Content-Type", "application/gzip");
      c.header("Content-Disposition", 'attachment; filename="silo-package.tar.gz"');
      c.header("Cache-Control", "no-store");
      return c.body(body);
    };

    app.post("/api/projects/:project/environments/:env/package", handler);
    app.post("/api/projects/:project/envs/:env/package", handler);
  }

  private static async readBody(c: Context): Promise<unknown> {
    try {
      return await c.req.json();
    } catch {
      throw new ValidationError("invalid JSON body");
    }
  }
}
