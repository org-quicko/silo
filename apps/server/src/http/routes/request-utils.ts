import type { Context } from "hono";
import { ValidationError } from "@silo/shared/validation-error";
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

  /**
   * Whether this request wants `{{NAME}}` substituted (D57).
   *
   * `?variables=raw` asks for the stored text. Resolving is the **default**,
   * because a template that only some callers see resolved is a feature nobody
   * can rely on — an app reading the API should not have to opt in to getting a
   * usable value. The one caller that wants the other side is an *editor*: a
   * form has to round-trip the reference somebody typed, and saving a resolved
   * value back would quietly replace the reference with a snapshot of it.
   *
   * An unrecognised value is refused rather than read as one of the two.
   * Guessing would mean `?variables=false` silently resolved, which is the
   * exact mistake this parameter exists to let a caller avoid.
   */
  static wantsRawVariables(c: Context): boolean {
    const asked = c.req.query("variables");
    if (asked === undefined || asked === "resolved") return false;
    if (asked === "raw") return true;
    throw new ValidationError(
      `invalid variables ${JSON.stringify(asked)}: want "resolved" (the default) or "raw"`
    );
  }
}
