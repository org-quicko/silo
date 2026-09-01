import { ClaimVocabulary } from "./claim-vocabulary";
import type { CollectionPermission } from "./collection-permission";

/**
 * The collection permissions a rename exercises (D51).
 *
 * A rename is a create at the new name and a delete at the old one, so it asks
 * for both — the same "hold the claims for what this actually does" rule
 * `ForcedDeletePermissions`, `TransferPermissions.Replace`,
 * `ScopeCopyPermissions.Replace` and `MediaForceDeletePermissions` each state
 * at their own reach.
 *
 * Neither half is enough alone. `collections:create` would let a caller who may
 * only add collections retire an existing name; `collections:delete` would let
 * one who may only remove them introduce a new one, on content it may not
 * otherwise write to.
 *
 * The *reach* is the subject's: `{project}/*​/*` for a project,
 * `{project}/{env}/*` for an environment, the one collection for a collection.
 * Stated here rather than at the three route guards so the admin UI can gate
 * its rename controls on exactly what the routes enforce.
 *
 * What a rename **cascades** into — rewriting claim strings that name the old
 * name — is a separate ask, checked only when there is something to rewrite.
 * See `docs/design/http-api.md`.
 */
export class RenamePermissions {
  static readonly All: readonly CollectionPermission[] = [
    ClaimVocabulary.CollectionCreate,
    ClaimVocabulary.CollectionDelete,
  ];
}
