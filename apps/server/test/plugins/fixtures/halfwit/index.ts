// Declares a runtime and exports neither half of it. The start refuses, for the
// same reason a declared hook with no export does: from outside, a plugin whose
// `activate` never ran looks exactly like one whose setup succeeded.
import { defineSiloPlugin } from "silo:api";

export default defineSiloPlugin({});
