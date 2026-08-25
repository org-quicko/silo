// The worker half. A package contributing a provider *and* hooks is what `kind`
// made impossible (D36) — and the two halves cannot share a module, because this
// one runs in a Worker after the store exists and `blob.ts` is imported into the
// host before it does.
import { defineSiloPlugin } from "silo:api";

export default defineSiloPlugin({
  "entry.afterWrite"(event: any, ctx: any) {
    ctx.log.info("saw a write", { id: event.id });
  },
});
