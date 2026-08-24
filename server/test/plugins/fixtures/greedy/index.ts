// Requests a claim the test deliberately does not grant.
import { defineSiloPlugin } from "silo:api";

export default defineSiloPlugin({
  async "entry.afterWrite"() {},
});
