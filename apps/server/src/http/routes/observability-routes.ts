import { Claims } from "@silo/shared/claims";
import type { Context } from "hono";
import type { Observability } from "../../observability";
import { RouteAuth } from "../auth/route-auth";

/**
 * `GET /api/observability` — one bounded snapshot of this process.
 *
 * The response contains aggregate operating facts only. Query strings, entry
 * and other ids, caller identities, content, credentials and filesystem paths
 * never enter the accumulator, so granting this does not quietly become a
 * content-read or settings-read capability. Endpoints carry the project,
 * environment and collection names of successful requests (D99), and each
 * caller sees only the names its own collection claims reach; the rest are
 * folded into their route pattern.
 */
export class ObservabilityRoutes {
  static register(app: any, observability: Observability): void {
    app.get("/api/observability", (c: Context) => {
      const key = RouteAuth.requireClaim(c, Claims.ObservabilityRead);
      return c.json(
        observability.snapshot((scope) => Claims.reaches(key.claims, scope.project, scope.env, scope.collection))
      );
    });
  }
}
