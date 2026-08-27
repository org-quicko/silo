import type { HookOp } from "../hook-op";
import type { HookOrigin } from "../hook-origin";
import type { HookScope } from "../hook-scope";

/**
 * What every hook event carries (D31/§13.5, D33).
 *
 * Every field is plain JSON. That is not a style preference: extension plugins
 * run in a `Worker`, so a payload crosses a structured-clone boundary and a
 * live object could not make the trip. Keeping the shape serializable by
 * construction is also what leaves a future WASM or subprocess boundary
 * reachable without changing a single plugin's source.
 */
export interface HookEventBase {
  op: HookOp;
  origin: HookOrigin;
  scope: HookScope;
  collection: string;

  /**
   * The plugins whose hooks caused this one, in order (see `WriteContext`).
   *
   * Host-side only: `WorkerHost` projects it to a `depth` count at the clone
   * boundary, because a plugin needs to know how nested it is and has no
   * business learning which *other* plugins are installed.
   */
  chain: readonly string[];
}
