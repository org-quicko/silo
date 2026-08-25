import type { Context, Next } from "hono";
import type { SiloService } from "../../core/services/silo-service";

/** Resolves the presented API key (if any) into `c.get("keyInfo")`. */
export class AuthMiddleware {
  static create(service: SiloService, authDisabled: boolean) {
    return async (c: Context, next: Next) => {
      if (c.req.path === "/api/health") {
        await next();
        return;
      }

      if (authDisabled) {
        // `id: ""` and not a made-up one: there is no key here, and every
        // consumer treats the empty id as "no key to name" rather than as a key
        // called the empty string. It is what keeps `parent_id` and
        // `granted_by` absent on an instance running without auth, instead of
        // pointing at a record that does not exist (D38).
        c.set("keyInfo", { id: "", label: "auth-disabled", claims: ["*"], prefix: "", hash: "" });
        await next();
        return;
      }

      let secret = "";
      const authHeader = c.req.header("Authorization");
      if (authHeader && authHeader.startsWith("Bearer ")) {
        secret = authHeader.substring(7).trim();
      } else {
        secret = c.req.header("X-Api-Key") || "";
      }

      if (!secret) {
        c.set("keyInfo", undefined);
        await next();
        return;
      }

      try {
        const info = await service.keys.authenticate(secret);
        c.set("keyInfo", info);
        await next();
      } catch (caught: any) {
        return c.json(
          { error: { code: "unauthorized", message: "invalid API key" } },
          401
        );
      }
    };
  }
}
