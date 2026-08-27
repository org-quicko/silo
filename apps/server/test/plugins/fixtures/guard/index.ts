// A veto hook. Throwing ValidationError is a *rejection* (400), not a fault.
import { defineSiloPlugin, ValidationError } from "silo:api";

export default defineSiloPlugin({
  "entry.beforeWrite"(event: any) {
    if (event.data?.blocked === true) {
      throw new ValidationError("blocked by the guard plugin", [
        { path: "/blocked", message: "must not be true" },
      ]);
    }
  },
});
