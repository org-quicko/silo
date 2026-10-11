import type { Context, Next } from "hono";
import { StorageBusyError } from "../../core/errors/storage-busy-error";
import type { SiloService } from "../../core/services/silo-service";
import { InjectedPrincipals } from "../auth/injected-principals";

/** Resolves the caller — injected or presented — into `c.get("keyInfo")`. */
export class AuthMiddleware {
  static create(service: SiloService, authDisabled: boolean) {
    return async (c: Context, next: Next) => {
      if (c.req.path === "/api/health") {
        await next();
        return;
      }

      /**
       * A host-injected principal wins, and is read **before** the
       * `authDisabled` branch (D35, D37 F5).
       *
       * Order is the whole of it. `--no-auth` gives every request `["*"]`,
       * which is right for what it means — a development instance with no
       * credentials — and becomes wrong the moment `ctx.fetch` dispatches
       * through this same middleware: every plugin on every development
       * instance would silently hold root, which is precisely where plugins are
       * written and tested. The grant model would then be untested exactly
       * where it is most exercised, and an author would discover their claims
       * were wrong in production.
       *
       * The slot is a module-private symbol on `env`, so nothing arriving over
       * a socket can reach it — see `InjectedPrincipals`.
       */
      const injected = InjectedPrincipals.of(c);
      if (injected) {
        c.set("keyInfo", injected.key);
        c.set("writeContext", injected.write);
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

      let info: Awaited<ReturnType<SiloService["keys"]["authenticate"]>>;
      try {
        info = await service.keys.authenticate(secret);
      } catch (caught: unknown) {
        // Storage that could not look the key up says nothing about the key:
        // the error handler answers 503 with Retry-After. A 401 here would
        // tell every client with a valid key to drop it during a database
        // blip, or whenever the scan queue is full.
        if (caught instanceof StorageBusyError) throw caught;
        return c.json(
          { error: { code: "unauthorized", message: "invalid API key" } },
          401
        );
      }
      c.set("keyInfo", info);
      await next();
    };
  }
}
