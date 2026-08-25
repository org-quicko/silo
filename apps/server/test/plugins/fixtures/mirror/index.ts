// Writes through ctx, which is what exercises the claim check and the causal
// chain. Deliberately does **not** guard on `origin`: since D33 the host skips
// a plugin already in the chain, so a naive plugin can no longer recurse into
// itself. This fixture is naive on purpose — guarding here would test the
// guard rather than the host.
import { defineSiloPlugin } from "silo:api";

export default defineSiloPlugin({
  async "entry.afterWrite"(event: any, ctx: any) {
    await ctx.entries.create(event.scope, ctx.config.into ?? "mirrors", {
      title: `copy of ${event.id}`,
    });
  },
});
