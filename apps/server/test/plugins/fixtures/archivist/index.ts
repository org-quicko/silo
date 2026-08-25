// The collection-level hook (D36, closing D37's F6). It writes one row per
// erasure, which is the only way a test can see that a forced delete — which
// dispatches no `entry.afterDelete` at all — was nonetheless observable.
//
// It writes into a **fixed** scope rather than `event.scope`, and that is the
// fixture illustrating the event: for an environment or project delete the scope
// it is being told about is already gone, along with every collection in it. A
// plugin that mirrors into the scope it watches has nowhere to write by the time
// it hears.
import { defineSiloPlugin } from "silo:api";

export default defineSiloPlugin({
  async "collection.afterDelete"(event: any, ctx: any) {
    await ctx.entries.create(
      { project: "default", env: "prod" },
      ctx.config.into ?? "mirrors",
      { title: `erased ${event.collection} (${event.erased}, ${event.cause})` }
    );
  },
});
