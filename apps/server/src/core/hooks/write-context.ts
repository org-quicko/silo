import type { HookOrigin } from "./hook-origin";

/**
 * Who asked for a write, and which plugins' hooks are on the stack that caused
 * it (D31, D33).
 *
 * Passed down the write path rather than stored on the entry: `origin` is
 * dispatch context, and persisting it would force a `format_version` bump
 * (D14) for a debugging aid.
 *
 * Optional at every call site, defaulting to an ordinary API write, so callers
 * with no opinion do not have to acquire one.
 */
export interface WriteContext {
  origin: HookOrigin;

  /**
   * The plugins whose hooks are currently on the stack above this write, in
   * order — empty for a request, `["slugger"]` for a write slugger's hook made.
   *
   * `HookBus` refuses to dispatch to a plugin already named here, which is what
   * makes a cycle **unrepresentable** rather than merely expensive: a plugin
   * can never be re-entered by a write it caused, directly or through any
   * number of other plugins.
   */
  chain: readonly string[];
}
