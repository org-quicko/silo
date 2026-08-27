import type { Context } from "hono";
import { Claims } from "@silo/shared/claims";
import { ValidationError } from "@silo/shared/validation-error";
import type { SiloService } from "../../core/services/silo-service";
import { RouteAuth } from "../auth/route-auth";

/**
 * `GET /api/audit` — the trail of authority changes (D38).
 *
 * Read-only, and there is no route to write one: an event is appended by the
 * service that made the change, so an actor cannot append an entry claiming
 * something happened that did not. There is no delete either, which is why
 * `audit:read` has no `audit:write` beside it — a claim guarding a capability
 * that does not exist would imply one that does.
 *
 * `?subject=` filters to one key id or plugin name, which is the question
 * anyone actually brings to a trail: not "what happened" but "what happened to
 * this".
 */
export class AuditRoutes {
  static register(app: any, service: SiloService) {
    app.get("/api/audit", async (c: Context) => {
      RouteAuth.requireClaim(c, Claims.AuditRead);
      const response = await service.audit.list({
        limit: AuditRoutes.number(c.req.query("limit"), "limit"),
        offset: AuditRoutes.number(c.req.query("offset"), "offset"),
        subject: c.req.query("subject") || undefined,
      });
      return c.json(response);
    });
  }

  private static number(raw: string | undefined, name: string): number | undefined {
    if (raw === undefined) return undefined;
    const value = Number.parseInt(raw, 10);
    if (Number.isNaN(value)) throw new ValidationError(`invalid ${name} "${raw}"`);
    return value;
  }
}
