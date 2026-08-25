import type { HookOp } from "../hook-op";
import type { HookOrigin } from "../hook-origin";
import type { HookScope } from "../hook-scope";

/**
 * What every hook event carries (D31/§13.5).
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
  /** How many plugin-originated writes deep this dispatch is. Bounded by
   *  `HookBus.MaxDepth` so a hook that writes cannot recurse forever. */
  depth: number;
}
