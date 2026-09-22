import type { Context } from "hono";
import { Claims } from "@silo/shared/claims";
import type { AuthenticatedKey } from "../../core/keys/authenticated-key";
import type { CollectionPermission } from "@silo/shared/collection-permission";
import type { TrashView } from "../../core/trash/trash-view";

/**
 * Who may see what in the trash (D91).
 *
 * There is no `trash:read` claim. A single global one would show entry data,
 * collection names and filenames from every scope in the instance to anyone who
 * held it, so each receipt is instead gated on the read claim its **origin**
 * already requires. A key sees exactly the deletions it could have seen the
 * content of.
 *
 * Media is visible to any authenticated caller, because reading the library has
 * needed no claim since D58 retired `media:read`.
 */
export class TrashVisibility {
  static filter(c: Context, views: readonly TrashView[]): TrashView[] {
    const key = c.get("keyInfo") as AuthenticatedKey | undefined;
    if (!key) return [];
    return views.filter((view) => TrashVisibility.visible(key, view));
  }

  static canSee(c: Context, view: TrashView): boolean {
    const key = c.get("keyInfo") as AuthenticatedKey | undefined;
    return key ? TrashVisibility.visible(key, view) : false;
  }

  private static visible(key: AuthenticatedKey, view: TrashView): boolean {
    const { project_name, env_name, collection_name } = view.origin;
    switch (view.kind) {
      case "media":
      case "media_folder":
        return true;
      case "entry":
        return TrashVisibility.holds(
          key,
          project_name,
          env_name,
          collection_name,
          Claims.CollectionEntriesRead
        );
      case "collection":
        return TrashVisibility.holds(
          key,
          project_name,
          env_name,
          view.subject_name,
          Claims.CollectionSchemaRead
        );
      case "environment":
        return TrashVisibility.holds(
          key,
          project_name,
          view.subject_name,
          "*",
          Claims.CollectionSchemaRead
        );
      case "project":
        return TrashVisibility.holds(
          key,
          view.subject_name,
          "*",
          "*",
          Claims.CollectionSchemaRead
        );
    }
  }

  private static holds(
    key: AuthenticatedKey,
    project: string | undefined,
    env: string | undefined,
    collection: string | undefined,
    permission: CollectionPermission
  ): boolean {
    if (!project || !env || !collection) return false;
    return Claims.has(key.claims, Claims.collection(project, env, collection, permission));
  }
}
