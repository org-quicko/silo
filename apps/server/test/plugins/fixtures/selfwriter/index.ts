// Writes back into the **same collection** it hooks, with no guard of its own.
//
// `mirror` writes into a different one, so a lost causal chain there shows up
// as a bounded recursion that ends at `HookBus.MaxDepth`. This one is the sharp
// case: without the chain surviving the HTTP hop `ctx.fetch` now makes, the
// first write feeds its own `afterWrite` immediately and the only thing between
// it and a loop is the depth bound.
import { defineSiloPlugin } from "silo:api";

export default defineSiloPlugin({
  async "entry.afterWrite"(event: any, ctx: any) {
    await ctx.entries.create(event.scope, event.collection, { title: `echo of ${event.id}` });
  },
});
