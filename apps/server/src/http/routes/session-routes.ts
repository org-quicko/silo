import type { Context } from "hono";
import { Claims } from "@silo/shared/claims";
import { RouteAuth } from "../auth/route-auth";

export class SessionRoutes {
  static register(app: any): void {
    app.get("/api/session", (c: Context) => {
      const key = RouteAuth.requireKey(c);
      return c.json({
        label: key.label,
        prefix: key.prefix || "",
        claims: Claims.normalize(key.claims),
      });
    });
  }
}
