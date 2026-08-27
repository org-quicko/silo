import { ClaimVocabulary } from "./claim-vocabulary";
import type { CollectionPermission } from "./collection-permission";

/**
 * The collection permissions an instance-wide export or import exercises.
 *
 * An archive spans every project and environment at once, and the `transfer:*`
 * claims are fixed — they carry no scope of their own. Holding one is therefore
 * necessary but not sufficient: the caller must also hold these at `*`/`*`/`*`,
 * which is exactly the authority the archive confers. Without that,
 * `transfer:export` would let a key confined to one project read every other
 * one. Stated here so the route guard and the UI's affordances cannot disagree.
 */
export class TransferPermissions {
  static readonly Read: readonly CollectionPermission[] = [
    ClaimVocabulary.CollectionSchemaRead,
    ClaimVocabulary.CollectionEntriesRead,
  ];

  /**
   * Create collections in any scope and overwrite their schemas and entries.
   *
   * The apply stage writes schemas, not just entries: it calls `putSchema` for
   * every collection the archive carries — in both modes — and creates any
   * project, env or collection the archive names that is missing locally. So
   * `create` and `schema:update` belong here for the same reason the collection
   * and project routes ask for them when a caller does that work by hand.
   * Deletion is *not* here — `merge` mode deletes nothing.
   */
  static readonly Write: readonly CollectionPermission[] = [
    ClaimVocabulary.CollectionCreate,
    ClaimVocabulary.CollectionSchemaUpdate,
    ClaimVocabulary.CollectionEntriesCreate,
    ClaimVocabulary.CollectionEntriesUpdate,
  ];

  /**
   * Additionally required in `replace` mode, which clears every collection the
   * archive carries — entries and schema both — before writing it back.
   */
  static readonly Replace: readonly CollectionPermission[] = [
    ClaimVocabulary.CollectionDelete,
    ClaimVocabulary.CollectionEntriesDelete,
  ];
}
