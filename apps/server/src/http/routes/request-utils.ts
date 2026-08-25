import type { Context } from "hono";
import { InjectedPrincipals } from "../auth/injected-principals";

export class RequestUtils {
  /**
   * The origin to write into a media URL, or `""` when there is none.
   *
   * A network request always has one: the `Host` header names where the client
   * reached this instance, and the forwarded headers name where the client
   * *thinks* it did, which is the answer a proxy makes correct.
   *
   * A request a plugin dispatched has neither (D35). It never crossed a socket,
   * so the only host in it is the fictional origin `PluginApiDispatcher` resolves
   * paths against — and rewriting `silo://media/<id>` into a URL rooted at a
   * hostname that resolves nowhere is worse than not rewriting it: a plugin that
   * stores or forwards that value has persisted a dead link, and one comparing
   * it against the stored reference finds no match. Returning `""` leaves the
   * reference as stored, which is what `ctx` handed plugins before phase 3 and
   * the only honest answer to "where is this instance reachable" when nothing
   * asked over the network.
   */
  static getBaseUrl(c: Context): string {
    if (InjectedPrincipals.of(c)) return "";

    const reqUrl = new URL(c.req.url);
    const proto = c.req.header("x-forwarded-proto") || reqUrl.protocol.replace(":", "");
    const host = c.req.header("x-forwarded-host") || c.req.header("host") || reqUrl.host;
    return `${proto}://${host}`;
  }
}
