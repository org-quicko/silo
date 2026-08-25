// Spins forever. Nothing preempts JavaScript, so only a Worker the host can
// terminate survives this — see WorkerHost.
import { defineSiloPlugin } from "silo:api";

export default defineSiloPlugin({
  "entry.beforeValidate"() {
    while (true) {
      // deliberately empty
    }
  },
});
