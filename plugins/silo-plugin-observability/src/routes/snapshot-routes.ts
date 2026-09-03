import type { SiloContext, SiloPluginDefinition } from "silo:api";

/** The panel's narrow bridge to the core claim-protected snapshot. */
export class SnapshotRoutes {
  static handlers(): SiloPluginDefinition {
    return {
      "GET /snapshot": async (_request: unknown, ctx: SiloContext) => {
        const response = await ctx.fetch("/api/observability");
        let json: any;
        try {
          json = response.json();
        } catch {
          json = {
            error: {
              code: "invalid_observability_response",
              message: "silo returned an observability response that was not JSON",
            },
          };
        }
        return { status: response.status, json };
      },
    };
  }
}
