import type { CollectionClaim } from "./collection-claim";
import type { FixedClaim } from "./fixed-claim";

/**
 * Every claim silo can grant or check. Use this wherever a *whole* claim is
 * expected: it rejects the bare `CollectionPermission` fragments exposed as
 * `Claims.Collection*` constants, which would otherwise typecheck as strings
 * and silently never match a granted claim.
 */
export type Claim = "*" | FixedClaim | CollectionClaim;
