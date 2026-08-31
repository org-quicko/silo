import type { Context } from "hono";
import { Claims } from "@silo/shared/claims";
import { AuditUtils } from "../../core/audit/audit-utils";
import type { AuditActor } from "../../core/audit/audit-actor";
import type { AuthenticatedKey } from "../../core/keys/authenticated-key";
import type { MediaPolicySupervisor } from "../../settings";
import { MediaPolicySettings } from "../../settings";
import { RouteAuth } from "../auth/route-auth";

/**
 * Where media URLs point and what the library accepts (D46).
 *
 * The `[media]` half of the settings page, beside `/api/media/storage`'s
 * `[blob_storage]`. Two routes rather than one because they are two tables with
 * two failure modes: a bad allowlist is a typo, while a bad bucket cannot be
 * opened at all, and folding them together would make correcting the first
 * depend on the second still working.
 *
 * Registered before `MediaRoutes` for the reason `/api/media/folders` is: a
 * static segment has to be matched before `/api/media/:id` reads it as an id.
 *
 * Behind `media:configure` like its sibling. The base URL is not a secret, but
 * changing it redirects every media link the API hands out, and the allowlist
 * decides what may enter the instance — both are the same kind of statement
 * about the instance as choosing its bucket.
 */
export class MediaSettingsRoutes {
  static register(app: any, policy: MediaPolicySupervisor) {
    app.get("/api/media/settings", async (c: Context) => {
      RouteAuth.requireClaim(c, Claims.MediaConfigure);
      return c.json(await policy.view());
    });

    /**
     * A whole table, not a patch. Nothing here is write-only, so the form
     * always holds the current value and an omitted field can only mean it was
     * removed — the opposite reading to `secret_access_key` next door, and for
     * the opposite reason.
     */
    app.put("/api/media/settings", async (c: Context) => {
      const caller = RouteAuth.requireClaim(c, Claims.MediaConfigure);
      const input = MediaPolicySettings.parse(await c.req.json());
      return c.json(await policy.save(input, MediaSettingsRoutes.actor(caller)));
    });
  }

  /** The audit actor for a request. `--no-auth` has no key to name, so it is
   *  recorded as `system` rather than as a key with an empty id. */
  private static actor(caller: AuthenticatedKey): AuditActor {
    return caller.id ? AuditUtils.key(caller.id, caller) : { kind: "system" };
  }
}
