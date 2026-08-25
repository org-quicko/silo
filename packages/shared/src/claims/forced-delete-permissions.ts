import { ClaimVocabulary } from "./claim-vocabulary";
import type { CollectionPermission } from "./collection-permission";

/**
 * The collection permissions a `?force=true` delete exercises (D37).
 *
 * Without `force`, the collection, environment and project delete routes refuse
 * while any content exists — so `collection:delete` on its own is an honest ask:
 * the caller is removing a definition that holds nothing. With it, the same
 * request erases every entry underneath, dispatching no hooks and asking for no
 * revision. That is a bulk `entries:delete` wearing a collection-lifecycle
 * claim, so `force` asks for both.
 *
 * The same rule `TransferPermissions.Replace` and `ScopeCopyPermissions.Replace`
 * already state, at the third place it was true. Stated here rather than at the
 * three route guards so the admin UI gates its delete buttons on exactly what
 * the routes enforce — an affordance the server will refuse is worse than no
 * affordance.
 *
 * The *reach* is the caller's: one collection for a collection delete,
 * `{project}/{env}/*` for an environment, `{project}/*​/*` for a project.
 */
export class ForcedDeletePermissions {
  static readonly All: readonly CollectionPermission[] = [
    ClaimVocabulary.CollectionDelete,
    ClaimVocabulary.CollectionEntriesDelete,
  ];
}
