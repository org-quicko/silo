import type { Context } from "hono";
import { Claims } from "@silo/shared/claims";
import { ForbiddenError } from "../../core/errors/forbidden-error";
import type { CollectionPermission } from "@silo/shared/collection-permission";
import type { TrashView } from "../../core/trash/trash-view";
import { RouteAuth } from "./route-auth";
import { TrashVisibility } from "./trash-visibility";

/**
 * What a restore asks for (D113): the **write** claims at the destination, not
 * a claim of its own.
 *
 * Restoring an entry into `prod` is writing to `prod`. A `trash:restore` claim
 * would let a key place content in a scope it cannot otherwise write to, which
 * is the escalation shape D37 measured for `keys:import` — so the answer comes
 * from the vocabulary that already governs the destination.
 */
export class TrashRestoreAuthority {
  /**
   * Every receipt a restore replays: the one asked for, which the route has
   * already shown this key, and each ancestor `chain` adds. An ancestor the key
   * cannot read is a 403, not a 404: the blocked receipt already named it.
   */
  static requireEach(c: Context): (view: TrashView, rename: string | undefined) => void {
    return (view, rename) => {
      if (!TrashVisibility.canSee(c, view)) {
        throw new ForbiddenError(
          `restoring this also restores ${view.kind} "${view.subject_name}", which this key cannot read`
        );
      }
      TrashRestoreAuthority.require(c, view, rename);
    };
  }

  /** The permissions restoring this receipt exercises, at the reach it lands
   *  in: the origin's names as they are today (`TrashService` resolves them),
   *  and `rename` in place of the subject's own. A collection brings its
   *  entries back, so it asks for both. */
  static require(c: Context, view: TrashView, rename?: string): void {
    const { project_name, env_name, collection_name } = view.origin;
    // `||`, as `TrashRestorer` reads it: an empty rename is no rename.
    const subject = rename || view.subject_name;
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
        TrashRestoreAuthority.at(c, view, project_name, env_name, subject, [
          Claims.CollectionCreate,
          Claims.CollectionEntriesCreate,
        ]);
        return;
      case "environment":
        TrashRestoreAuthority.at(c, view, project_name, subject, "*", [
          Claims.CollectionCreate,
          Claims.CollectionEntriesCreate,
        ]);
        return;
      case "project":
        TrashRestoreAuthority.at(c, view, subject, "*", "*", [
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
