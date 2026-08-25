import { ClaimVocabulary } from "./claim-vocabulary";
import type { CollectionPermission } from "./collection-permission";

/**
 * The collection permissions a scope-to-scope copy exercises (D22).
 *
 * Unlike an archive, a copy between two scopes of one instance confers no
 * authority its caller does not already hold: the same result is reachable by
 * listing the source through the entry API and writing the destination through
 * it. So the guard asks for exactly the permissions that hand-rolled loop would
 * need — at the source for the read half, at the destination for the write
 * half — and for **no** `transfer:*` claim. Requiring one would force a key
 * confined to a single project to obtain instance-wide authority before it
 * could move its own data between its own environments, which is the coupling
 * D21 exists to prevent.
 */
export class ScopeCopyPermissions {
  static readonly Read: readonly CollectionPermission[] = [
    ClaimVocabulary.CollectionSchemaRead,
    ClaimVocabulary.CollectionEntriesRead,
  ];

  /** Create collections and overwrite their schemas and entries. */
  static readonly Write: readonly CollectionPermission[] = [
    ClaimVocabulary.CollectionCreate,
    ClaimVocabulary.CollectionSchemaUpdate,
    ClaimVocabulary.CollectionEntriesCreate,
    ClaimVocabulary.CollectionEntriesUpdate,
  ];

  /**
   * Additionally required in `replace` mode, which clears the destination's copy
   * of every collection the source carries before writing it.
   */
  static readonly Replace: readonly CollectionPermission[] = [
    ClaimVocabulary.CollectionDelete,
    ClaimVocabulary.CollectionEntriesDelete,
  ];
}
