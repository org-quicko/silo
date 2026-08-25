// Calls one configured path through the **raw** `ctx.fetch` and reports what
// came back in the entry it was asked to validate.
//
// Reporting into `data` rather than throwing is what makes the answer readable
// from a test: `beforeValidate` is the one hook that may rewrite the value, so
// whatever the plugin saw ends up stored and can be asserted on. A refusal is
// recorded the same way a success is, because the point of most of these probes
// is *which* refusal arrived.
import { defineSiloPlugin } from "silo:api";

export default defineSiloPlugin({
  async "entry.beforeValidate"(event: any, ctx: any) {
    try {
      const response = await ctx.fetch(ctx.config.path, {
        method: ctx.config.method ?? "GET",
        headers: ctx.config.headers,
      });
      return {
        data: {
          ...event.data,
          note: JSON.stringify({ status: response.status, body: response.text() }),
        },
      };
    } catch (caught: any) {
      return { data: { ...event.data, note: JSON.stringify({ threw: caught.message }) } };
    }
  },
});
