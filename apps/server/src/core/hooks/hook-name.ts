/**
 * Re-exported from `@silo/shared` (D34).
 *
 * The vocabulary moved there when hook *delivery* became a claim: the claim
 * grammar validates a hook name, and the admin UI renders the list, so both
 * sides need it and neither may own a second copy. This file stays so that
 * `core/hooks` remains the one import site a server-side reader looks for.
 */
export type { HookName } from "@silo/shared/hook-name";
