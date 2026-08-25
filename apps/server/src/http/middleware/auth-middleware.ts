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
        c.set("keyInfo", { label: "auth-disabled", claims: ["*"] });
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
