// Writes through ctx, which is what exercises the claim check and the depth
// guard. Ignores its own writes by origin, or it would recurse.
import { defineSiloPlugin } from "silo:api";

export default defineSiloPlugin({
  async "entry.afterWrite"(event: any, ctx: any) {
    if (event.origin.startsWith("plugin:")) return;
    await ctx.entries.create(event.scope, ctx.config.into ?? "mirrors", {
      title: `copy of ${event.id}`,
    });
  },
});
