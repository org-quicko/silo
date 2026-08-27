// Half of an **indirect** cycle: pinger writes a pong, ponger writes a ping.
// Neither can break it by checking `origin` for its own name, because neither
// ever sees its own name — the event that reaches it was raised by the other.
// Only the causal chain stops this (D33).
import { defineSiloPlugin } from "silo:api";

export default defineSiloPlugin({
  async "entry.afterWrite"(event: any, ctx: any) {
    if (event.collection !== "pings") return;
    await ctx.entries.create(event.scope, "pongs", { note: `pong for ${event.id}` });
  },
});
