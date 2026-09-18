import type { Context } from "hono";
import { Claims } from "@silo/shared/claims";
import type { CollectionPermission } from "@silo/shared/collection-permission";
import { ForbiddenError } from "../../core/errors/forbidden-error";
import type { TransferSelection } from "../../core/transfer/transfer-selection";
import { RouteAuth } from "./route-auth";

/**
 * What a transfer asks for, at the reach it actually has.
 *
 * An unselected transfer carries every project and environment, so it keeps
 * `requireInstanceWide` — holding `transfer:export` alone would hand a key
 * scoped to one project a way straight out of it. A **selected** one reaches
 * only what it names, so it asks only for that: the same rule the scoped copy
 * route has used since D22, applied to the archive routes now that they can be
 * narrowed (§7.6).
 */
export class TransferAuth {
  static require(
    c: Context,
    operation: string,
    selection: TransferSelection,
    permissions: readonly CollectionPermission[]
  ): void {
    if (selection.isEverything) {
      RouteAuth.requireInstanceWide(c, operation, permissions);
      return;
    }

    const key = RouteAuth.requireKey(c);
    for (const include of selection.toIncludes()) {
      const reach = [include.project, include.env ?? "*", include.collection ?? "*"] as const;
      for (const permission of permissions) {
        const claim = Claims.collection(reach[0], reach[1], reach[2], permission);
        if (!Claims.has(key.claims, claim)) {
          throw new ForbiddenError(
            `${operation} covers ${reach.join("/")}; this key is missing claim "${claim}"`
          );
        }
      }
    }
  }
}
