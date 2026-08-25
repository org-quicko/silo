// The other half of the indirect cycle. See `pinger`.
import { defineSiloPlugin } from "silo:api";

export default defineSiloPlugin({
  async "entry.afterWrite"(event: any, ctx: any) {
    if (event.collection !== "pongs") return;
    await ctx.entries.create(event.scope, "pings", { note: `ping for ${event.id}` });
  },
});
