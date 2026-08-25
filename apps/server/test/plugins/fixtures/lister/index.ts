// The same probe as `prober`, through the **generated client** instead of the
// raw fetch — so the pair together pins the split D35 draws: `ctx.fetch`
// reports a refusal as a status, and the typed methods turn it into a throw.
import { defineSiloPlugin } from "silo:api";

export default defineSiloPlugin({
  async "entry.beforeValidate"(event: any, ctx: any) {
    try {
      const page = await ctx.entries.list(event.scope, ctx.config.from, { limit: 5 });
      return { data: { ...event.data, note: JSON.stringify({ total: page.total }) } };
    } catch (caught: any) {
      return { data: { ...event.data, note: JSON.stringify({ threw: caught.name }) } };
    }
  },
});
