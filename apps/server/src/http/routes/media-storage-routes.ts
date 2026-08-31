import type { Context } from "hono";
import { Claims } from "@silo/shared/claims";
import { AuditUtils } from "../../core/audit/audit-utils";
import type { AuditActor } from "../../core/audit/audit-actor";
import type { AuthenticatedKey } from "../../core/keys/authenticated-key";
import type { MediaStorageSupervisor } from "../../settings";
import { MediaStorageSettings } from "../../settings";
import { RouteAuth } from "../auth/route-auth";

/**
 * Where the media library keeps its bytes (D45).
 *
 * Registered before `MediaRoutes` for the ordering reason `/api/media/folders`
 * exists above `/api/media/:id`: a static segment has to be matched before the
 * parameter that would otherwise read it as an asset id.
 *
 * Both verbs ask for **one** claim. `media:configure` is not the read/write
 * pair the keys and plugins APIs have, because the read is not the harmless
 * half here: it names the bucket, the endpoint and the access key id an
 * instance authenticates with, which is reconnaissance rather than metadata.
 * The secret is the one thing that never leaves — see `MediaStorageFacts`.
 */
export class MediaStorageRoutes {
  static register(app: any, storage: MediaStorageSupervisor) {
    app.get("/api/media/storage", async (c: Context) => {
      RouteAuth.requireClaim(c, Claims.MediaConfigure);
      return c.json(await storage.view());
    });

    /**
     * A whole configuration, not a patch — the fields are few and they are all
     * on one screen at once, so a PUT of what was read cannot leave a stale
     * value behind by omission. `secret_access_key` is the exception the read
     * forces: absent keeps the file's, `""` clears it.
     */
    app.put("/api/media/storage", async (c: Context) => {
      const caller = RouteAuth.requireClaim(c, Claims.MediaConfigure);
      const input = MediaStorageSettings.parse(await c.req.json());
      return c.json(await storage.save(input, MediaStorageRoutes.actor(caller)));
    });
  }

  /** The audit actor for a request. `--no-auth` has no key to name, so it is
   *  recorded as `system` rather than as a key with an empty id. */
  private static actor(caller: AuthenticatedKey): AuditActor {
    return caller.id ? AuditUtils.key(caller.id, caller) : { kind: "system" };
  }
}
