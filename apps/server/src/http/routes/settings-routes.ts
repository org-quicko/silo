import type { Context } from "hono";
import { Claims } from "@silo/shared/claims";
import { ValidationError } from "@silo/shared/validation-error";
import { AuditUtils } from "../../core/audit/audit-utils";
import type { AuditActor } from "../../core/audit/audit-actor";
import type { AuthenticatedKey } from "../../core/keys/authenticated-key";
import { ConfigSections } from "../../config/config-sections";
import type { ConfigSupervisor } from "../../settings";
import { ConfigSectionSettings } from "../../settings";
import { RouteAuth } from "../auth/route-auth";

/**
 * The rest of `silo.toml`, read and changed through the API (D47).
 *
 * One resource with a **table-scoped write**: `GET /api/settings` answers with
 * every section at once, because the page shows them together and four round
 * trips to draw one screen is four ways for it to be half-drawn; `PUT
 * /api/settings/{table}` writes one, because they are separate tables with
 * separate failure modes and a rejected `[search]` value must not stop a `[log]`
 * level being fixed.
 *
 * Behind **`settings:configure`**, one claim rather than a read/write pair for
 * `media:configure`'s reason: the read is not the harmless half, since it names
 * the data directory, the log path, and whether authentication is on at all.
 */
export class SettingsRoutes {
  static register(app: any, settings: ConfigSupervisor) {
    app.get("/api/settings", async (c: Context) => {
      RouteAuth.requireClaim(c, Claims.SettingsConfigure);
      return c.json(await settings.view());
    });

    /**
     * One table, as a whole document rather than a patch — its fields are few
     * and all on one card, so a `PUT` of what was read cannot leave a stale
     * value behind by omission. An unknown key is refused rather than dropped:
     * a typo that saved cleanly and did nothing is the worst of both.
     */
    app.put("/api/settings/:table", async (c: Context) => {
      const caller = RouteAuth.requireClaim(c, Claims.SettingsConfigure);
      const table = c.req.param("table") || "";

      const section = ConfigSections.find(table);
      if (!section) {
        throw new ValidationError(
          `no such settings section "${table}". There is: ` +
            `${ConfigSections.All.map((each) => each.table).join(", ")}.`
        );
      }

      const input = ConfigSectionSettings.parse(section, await c.req.json());
      return c.json(await settings.save(table, input, SettingsRoutes.actor(caller)));
    });
  }

  /** The audit actor for a request. `--no-auth` has no key to name, so it is
   *  recorded as `system` rather than as a key with an empty id. */
  private static actor(caller: AuthenticatedKey): AuditActor {
    return caller.id ? AuditUtils.key(caller.id, caller) : { kind: "system" };
  }
}
