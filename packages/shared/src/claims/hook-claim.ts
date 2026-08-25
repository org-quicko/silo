import type { HookName } from "../hooks/hook-name";

/**
 * A hook-delivery claim: `hooks:<project>/<env>/<collection>:<hook>` (D34).
 *
 * It governs whether an event is **delivered** to a plugin at all, not what the
 * plugin may do once it has one. That is a separate authority from anything in
 * `CollectionClaim` and deliberately not expressed as one: a plugin holding
 * `entry.beforeValidate` over a collection can rewrite every value written to
 * it, which no `entries:*` permission grants.
 *
 * Like `CollectionClaim`, each scope segment is `*` or a valid id, enforced at
 * runtime by `Claims.normalize`. The **hook segment carries no wildcard**, for
 * the reason D19 gives about action wildcards: a grant has to name what it
 * permits, and "every hook" is five words rather than one character.
 */
export type HookClaim = `hooks:${string}/${string}/${string}:${HookName}`;
