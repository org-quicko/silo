// A mutating hook: the canonical "enrich on the way in" plugin.
import { defineSiloPlugin } from "silo:api";

export default defineSiloPlugin({
  "entry.beforeValidate"(event: any, ctx: any) {
    const source = event.data?.[ctx.config.from];
    if (typeof source !== "string") return;
    return { data: { ...event.data, slug: source.toLowerCase().replace(/[^a-z0-9]+/g, "-") } };
  },
});
