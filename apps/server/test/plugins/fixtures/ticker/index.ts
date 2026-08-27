// A plugin with no hooks and no routes, which before D36 could not exist: an
// extension had to declare a hook merely to be loaded, so a package that only
// wanted to run something on startup invented one.
//
// Both halves write through `ctx`, because "activate ran" and "activate could
// act" are different claims and only the second one is worth making.
import { defineSiloPlugin } from "silo:api";

export default defineSiloPlugin({
  async activate(ctx: any) {
    await ctx.entries.create(
      { project: "default", env: "prod" },
      ctx.config.into ?? "mirrors",
      { title: "activated" }
    );
  },

  async deactivate(ctx: any) {
    await ctx.entries.create(
      { project: "default", env: "prod" },
      ctx.config.into ?? "mirrors",
      { title: "deactivated" }
    );
  },
});
