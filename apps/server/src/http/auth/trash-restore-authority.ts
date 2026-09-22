import type { Context } from "hono";
import { Claims } from "@silo/shared/claims";
import { ForbiddenError } from "../../core/errors/forbidden-error";
import type { CollectionPermission } from "@silo/shared/collection-permission";
import type { TrashView } from "../../core/trash/trash-view";
import { RouteAuth } from "./route-auth";

/**
 * What a restore asks for (D91): the **write** claims at the destination, not
 * a claim of its own.
 *
 * Restoring an entry into `prod` is writing to `prod`. A `trash:restore` claim
 * would let a key place content in a scope it cannot otherwise write to, which
 * is the escalation shape D37 measured for `keys:import` — so the answer comes
 * from the vocabulary that already governs the destination.
 */
export class TrashRestoreAuthority {
  /** The permissions restoring this receipt exercises, at the reach it lands
   *  in. A collection brings its entries back, so it asks for both. */
  static require(c: Context, view: TrashView): void {
    const { project_name, env_name, collection_name } = view.origin;
    switch (view.kind) {
      case "media":
      case "media_folder":
        RouteAuth.requireClaim(c, Claims.MediaCreate);
        return;
      case "entry":
        TrashRestoreAuthority.at(c, view, project_name, env_name, collection_name, [
          Claims.CollectionEntriesCreate,
        ]);
        return;
      case "collection":
        TrashRestoreAuthority.at(c, view, project_name, env_name, view.subject_name, [
          Claims.CollectionCreate,
          Claims.CollectionEntriesCreate,
        ]);
        return;
      case "environment":
        TrashRestoreAuthority.at(c, view, project_name, view.subject_name, "*", [
          Claims.CollectionCreate,
          Claims.CollectionEntriesCreate,
        ]);
        return;
      case "project":
        TrashRestoreAuthority.at(c, view, view.subject_name, "*", "*", [
          Claims.CollectionCreate,
          Claims.CollectionEntriesCreate,
        ]);
    }
  }

  private static at(
    c: Context,
    view: TrashView,
    project: string | undefined,
    env: string | undefined,
    collection: string | undefined,
    permissions: readonly CollectionPermission[]
  ): void {
    const key = RouteAuth.requireKey(c);
    if (!project || !env || !collection) {
      throw new ForbiddenError(`cannot tell where "${view.subject_name}" would be restored`);
    }
    for (const permission of permissions) {
      const claim = Claims.collection(project, env, collection, permission);
      if (!Claims.has(key.claims, claim)) {
        throw new ForbiddenError(
          `restoring "${view.subject_name}" writes to ${project}/${env}; this key is missing claim "${claim}"`
        );
      }
    }
  }
}
