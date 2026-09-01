import { defineSiloPlugin } from "silo:api";
import { SnapshotRoutes } from "./routes/snapshot-routes";

/** Operational analytics rendered in a sandboxed panel. */
export default defineSiloPlugin({
  ...SnapshotRoutes.handlers(),
});
