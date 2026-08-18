import type { Context } from "hono";
import { Claims } from "@silo/shared/claims";
import { Service } from "../../core/service/service";
import { ForbiddenError } from "../../core/errors/forbidden-error";
import { ValidationError } from "@silo/shared/validation-error";
import { RouteAuth } from "../auth/route-auth";

export class KeysRoutes {
  static register(app: any, svc: Service) {
    app.get("/api/keys", async (c: Context) => {
      RouteAuth.requireClaim(c, Claims.KeysRead);
      const keys = await svc.listKeys();
      const views = keys.map(Service.newKeyView);
      return c.json({ items: views });
    });

    app.post("/api/keys", async (c: Context) => {
      const caller = RouteAuth.requireClaim(c, Claims.KeysCreate);
      const body = await c.req.json();
      if (!body || typeof body !== "object") {
        throw new ValidationError("invalid body: want {label, claims}");
      }
      const claims = Claims.normalize(body.claims);
      if (!Claims.canDelegate(caller.claims, claims)) {
        throw new ForbiddenError("cannot create a key with claims the current key does not hold");
      }
      const { secret, entry } = await svc.createKey(body.label, claims);
      return c.json(
        {
          key: secret,
          ...Service.newKeyView(entry),
        },
        201
      );
    });

    app.delete("/api/keys/:id", async (c: Context) => {
      RouteAuth.requireClaim(c, Claims.KeysRevoke);
      const id = c.req.param("id") || "";
      await svc.revokeKey(id);
      return c.body(null, 204);
    });
  }
}
