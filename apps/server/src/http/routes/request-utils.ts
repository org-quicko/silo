import type { Context } from "hono";

export class RequestUtils {
  static getBaseUrl(c: Context): string {
    const reqUrl = new URL(c.req.url);
    const proto = c.req.header("x-forwarded-proto") || reqUrl.protocol.replace(":", "");
    const host = c.req.header("x-forwarded-host") || c.req.header("host") || reqUrl.host;
    return `${proto}://${host}`;
  }
}
