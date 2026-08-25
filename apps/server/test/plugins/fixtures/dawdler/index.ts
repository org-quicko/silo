// Overruns its dispatch budget on demand, so a test can produce a **dead
// worker** and then bring it back (D39, phase 4).
//
// It waits on a timer rather than spinning, which matters: a synchronous spin is
// what proves `timeout_ms` needs a worker at all (§13.9), but it also survives
// the test that produced it. Yielding lets `terminate()` collect the thread the
// moment the host gives up on it.
//
// `mark` is what it writes into the entry, so a config change is observable from
// the outside — which is how `PATCH .../config` is asserted without a channel of
// the plugin's own.
import { defineSiloPlugin } from "silo:api";

export default defineSiloPlugin({
  async "entry.beforeValidate"(event: any, ctx: any) {
    if (event.data?.slow === true) {
      await new Promise((resolve) => setTimeout(resolve, ctx.config.ms ?? 5000));
    }
    return { data: { ...event.data, note: ctx.config.mark ?? "default" } };
  },
});
