import type { Context } from "hono";
import { Claims } from "@silo/shared/claims";
import type { TrashView } from "../../core/trash/trash-view";
import { RouteAuth } from "./route-auth";

/** Receipt visibility permits reading metadata; container contents also need entry-read authority. */
export class TrashContentsAuthority {
  static require(c: Context, view: TrashView): void {
    const { project_name, env_name, collection_name } = view.origin;
    switch (view.kind) {
      case "entry":
        RouteAuth.requireCollectionClaim(c, project_name!, env_name!, collection_name!, Claims.CollectionEntriesRead);
        break;
      case "collection":
        RouteAuth.requireCollectionClaim(c, project_name!, env_name!, view.subject_name, Claims.CollectionEntriesRead);
        break;
      case "environment":
        RouteAuth.requireCollectionClaim(c, project_name!, view.subject_name, "*", Claims.CollectionEntriesRead);
        break;
      case "project":
        RouteAuth.requireCollectionClaim(c, view.subject_name, "*", "*", Claims.CollectionEntriesRead);
        break;
    }
  }
}
