import { QueryString } from "../transport/query-string.js";
import type { TransportQueryValue } from "../transport/transport-request.js";

/** Request identity within a transport whose URL and authentication are fixed. */
export class CacheKey {
  static of(method: string, path: string, query?: Record<string, TransportQueryValue>): string {
    const sorted = query && Object.fromEntries(Object.keys(query).sort().map((name) => [name, query[name]]));
    return `${method} ${path}${QueryString.build(sorted)}`;
  }

  static matches(key: string, pathPrefix: string): boolean {
    const path = key.slice(key.indexOf(" ") + 1);
    return path === pathPrefix || path.startsWith(`${pathPrefix}/`) || path.startsWith(`${pathPrefix}?`);
  }
}
