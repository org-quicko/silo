import type { Context } from "hono";
import { Claims } from "@silo/shared/claims";
import type { SiloService } from "../../core/services/silo-service";
import { RouteAuth } from "../auth/route-auth";

export class SessionRoutes {
  /**
   * `trash` rides along because every delete dialog in the admin has to say
   * whether the delete can be undone, and that is an instance setting the
   * client cannot otherwise see (D91). A dialog that promises a restore on an
   * instance with `[trash] enabled = false` is worse than one that promises
   * nothing.
   */
  static register(app: any, service: SiloService): void {
    app.get("/api/session", (c: Context) => {
      const key = RouteAuth.requireKey(c);
      return c.json({
        label: key.label,
        prefix: key.prefix || "",
        claims: Claims.normalize(key.claims),
        trash: {
          enabled: service.trash.enabled,
          retention_days: service.trash.retentionDays,
        },
      });
    });
  }
}
