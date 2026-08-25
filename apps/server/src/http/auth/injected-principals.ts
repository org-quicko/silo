import type { Context } from "hono";
import type { InjectedPrincipal } from "./injected-principal";

/**
 * The one slot an injected principal travels in, and the only two operations on
 * it (D35).
 *
 * The key is a **module-private symbol**. Not a string, and not exported: a
 * string key on `env` is something a caller could name, and Hono's `env` is the
 * runtime's bindings object, which for a real request is Bun's environment and
 * carries nothing of ours. So a request arriving over the network cannot reach
 * this slot even by accident — there is no header, query parameter or body
 * shape that becomes a symbol-keyed property.
 *
 * That unforgeability is what lets `AuthMiddleware` trust the slot **more** than
 * a bearer token, and it is why the phase-3 middleware reads it *before* the
 * `--no-auth` branch rather than after (D37 F5).
 */
export class InjectedPrincipals {
  private static readonly Slot = Symbol("silo.injected-principal");

  /** The `env` argument to hand `app.request` / `app.fetch`. */
  static env(principal: InjectedPrincipal): Record<string, unknown> {
    return { [InjectedPrincipals.Slot]: principal } as Record<string, unknown>;
  }

  /** The principal this request was dispatched with, if it was dispatched at
   *  all. `undefined` for every request that arrived over a socket. */
  static of(c: Context): InjectedPrincipal | undefined {
    const env = c.env as Record<PropertyKey, unknown> | undefined;
    if (!env || typeof env !== "object") return undefined;
    return env[InjectedPrincipals.Slot] as InjectedPrincipal | undefined;
  }
}
