import type { HookOrigin } from "./hook-origin";

/**
 * Who asked for a write, and how deep in plugin-triggered writes it is (D31).
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
  depth: number;
}
