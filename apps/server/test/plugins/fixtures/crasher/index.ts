// A plugin *fault* — an ordinary throw, which on_error governs.
import { defineSiloPlugin } from "silo:api";

export default defineSiloPlugin({
  "entry.beforeWrite"() {
    throw new Error("kaboom");
  },
});
