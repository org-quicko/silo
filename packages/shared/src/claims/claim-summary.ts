import type { AccessLevel } from "./access-level";
import { ClaimAuthorizer } from "./claim-authorizer";
import { ClaimVocabulary } from "./claim-vocabulary";
import type { CollectionPermission } from "./collection-permission";
import type { ParsedClaim } from "./parsed-claim";

/** How a claim list is described to a person. */
export class ClaimSummary {
  private static readonly WritePermissions: readonly CollectionPermission[] = [
    ClaimVocabulary.CollectionEntriesCreate,
    ClaimVocabulary.CollectionEntriesUpdate,
    ClaimVocabulary.CollectionEntriesDelete,
    ClaimVocabulary.CollectionCreate,
    ClaimVocabulary.CollectionDelete,
    ClaimVocabulary.CollectionSchemaUpdate,
    ClaimVocabulary.CollectionAccessUpdate,
  ];

  private static readonly ReadPermissions: readonly CollectionPermission[] = [
    ClaimVocabulary.CollectionEntriesRead,
    ClaimVocabulary.CollectionSchemaRead,
  ];

  /**
   * How much authority a key has **within one scope**, as the three bands the
   * UI can act on. Unlike a key's label this is derived, so it changes as the
   * user switches project/env — a key that writes in `dev` and only reads in
   * `prod` reports each honestly. Omitting the scope asks the same question of
   * the instance as a whole.
   *
   * Bands are widest-first: any write permission anywhere in the scope makes it
   * "write", because a surface that claimed read-only while a create button was
   * live would be the more misleading of the two errors.
   */
  static accessLevel(
    claims: readonly string[] | readonly ParsedClaim[],
    project?: string,
    env?: string,
  ): AccessLevel {
    if (ClaimAuthorizer.holdsRoot(claims)) return "root";

    const holds = (permission: CollectionPermission) =>
      ClaimAuthorizer.hasAnyCollectionPermission(claims, permission, project, env);

    if (ClaimSummary.WritePermissions.some(holds)) return "write";
    if (ClaimSummary.ReadPermissions.some(holds)) return "read";
    return "none";
  }

  static label(claims: readonly string[]): string {
    if (claims.includes(ClaimVocabulary.Root)) return "root access";
    return `${claims.length} claim${claims.length === 1 ? "" : "s"}`;
  }
}
