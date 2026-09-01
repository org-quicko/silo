import { Claims } from "@silo/shared/claims";
import type { Context } from "hono";
import type { Observability } from "../../observability";
import { RouteAuth } from "../auth/route-auth";

/**
 * `GET /api/observability` — one bounded snapshot of this process.
 *
 * The response deliberately contains aggregate, low-cardinality operating
 * facts only. Request parameters, query strings, caller identities, content,
 * credentials and filesystem paths never enter the accumulator, so granting
 * this does not quietly become a content-read or settings-read capability.
 */
export class ObservabilityRoutes {
  static register(app: any, observability: Observability): void {
    app.get("/api/observability", (c: Context) => {
      RouteAuth.requireClaim(c, Claims.ObservabilityRead);
      return c.json(observability.snapshot());
    });
  }
}
