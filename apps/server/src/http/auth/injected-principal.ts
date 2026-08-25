import type { WriteContext } from "../../core/hooks";
import type { AuthenticatedKey } from "../../core/keys/authenticated-key";

/**
 * A caller the **host** attached to a request rather than one that presented a
 * credential (D35).
 *
 * This is how a plugin's `ctx.fetch` becomes an authenticated request against
 * the same Hono app a real one hits: identity is handed in beside the request
 * instead of parsed out of it. `AuthMiddleware` reads it in place of the
 * `Authorization` header, so every route guard downstream is unchanged and
 * unaware — which is the point, because a second authorization path is a second
 * thing that can disagree with the first.
 *
 * It carries the write context too. D33's causal chain has to survive the hop:
 * a plugin's HTTP-shaped write must still refuse to re-enter its own hooks, and
 * before this the chain lived in `PluginContext` — the very thing this replaces.
 * One slot rather than two, because they are one fact: *who is asking, and what
 * caused them to ask.*
 */
export interface InjectedPrincipal {
  /**
   * The plugin's managed key, as `AuthMiddleware` would have resolved it.
   *
   * Synthesised from the grant rather than authenticated from a secret: **the
   * channel is the credential** (D35). A worker never holds its own secret, so
   * a plugin cannot present a different one — and there is no header for it to
   * present it in that this would read.
   */
  key: AuthenticatedKey;

  /** The chain that caused this request, extended with the calling plugin. */
  write: WriteContext;
}
