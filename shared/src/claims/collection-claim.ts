import type { CollectionPermission } from "./collection-permission";

/**
 * A collection-scoped claim. Each segment (project, env, name) is `*` or a valid id;
 * `Claims.normalize` is what enforces the segment grammar at runtime, so this type
 * only guarantees the shape — enough to keep a bare `CollectionPermission` from
 * being passed where a whole claim is expected.
 */
export type CollectionClaim = `collections:${string}/${string}/${string}:${CollectionPermission}`;

