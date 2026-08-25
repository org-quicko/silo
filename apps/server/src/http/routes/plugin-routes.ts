import type { Context } from "hono";
import { Claims } from "@silo/shared/claims";
import { ValidationError } from "@silo/shared/validation-error";
import type { SiloService } from "../../core/services/silo-service";
import type { AuditActor } from "../../core/audit/audit-actor";
import { AuditUtils } from "../../core/audit/audit-utils";
import type { AuthenticatedKey } from "../../core/keys/authenticated-key";
import type { GrantRequest } from "../../core/services/support/grant-request";
import { NotFoundError } from "../../core/errors/not-found-error";
import { RouteAuth } from "../auth/route-auth";
import { PluginViews } from "./plugin-view";

/**
 * `/api/plugins/*` — the management surface D31 reserved this namespace for and
 * D34 redirected it to (D38).
 *
 * It manages **grants**, not packages. Everything here reads and writes the
 * `_plugins` record and nothing reaches the filesystem, which is the split D34
 * drew: `silo.toml` says what loads and in what order, the store says what it
 * may do. That is also why there is no `rescan` and no `PATCH .../config` yet —
 * both need to read a manifest from disk, and both only *take effect* once
 * phase 4's supervisor can reload without a restart. Shipping them before then
 * would be an API whose whole answer is "restart to find out".
 *
 * Every mutation is fenced with `If-Match`. On a grant that is not ceremony:
 * approving means approving **what you read**, and a package whose request
 * changed between the read and the approval is exactly the substitution
 * `needs_review` exists to catch.
 */
export class PluginRoutes {
  static register(app: any, service: SiloService) {
    app.get("/api/plugins", async (c: Context) => {
      RouteAuth.requireClaim(c, Claims.PluginsRead);
      const records = await service.plugins.list();
      return c.json({ items: records.map(PluginViews.of) });
    });

    app.get("/api/plugins/:name", async (c: Context) => {
      RouteAuth.requireClaim(c, Claims.PluginsRead);
      const view = PluginViews.of(await PluginRoutes.require(service, c.req.param("name") || ""));
      c.header("ETag", `"${view.rev}"`);
      return c.json(view);
    });

    /**
     * Approve, or narrow an existing approval.
     *
     * `PUT` and not `POST`: the body is the complete granted set, so sending it
     * twice grants the same thing. A `POST .../grant` that appended would make
     * "approve exactly these three claims" impossible to express without first
     * revoking, and an operator narrowing a grant is the case that matters most.
     *
     * An omitted `claims` means everything requested — the same default
     * `silo plugin grant` takes, for the same reason: granting in full is the
     * common case and narrowing is the deliberate one, so narrowing is what
     * takes an argument.
     */
    app.put("/api/plugins/:name/grant", async (c: Context) => {
      const caller = RouteAuth.requireClaim(c, Claims.PluginsGrant);
      const name = c.req.param("name") || "";
      const record = await PluginRoutes.require(service, name);
      const body = await PluginRoutes.body(c);

      const claims =
        body.claims === undefined ? record.requested : Claims.normalize(body.claims);
      const granted = await service.plugins.grant(
        name,
        claims,
        PluginRoutes.request(c, caller)
      );
      return c.json(PluginViews.of(granted));
    });

    app.delete("/api/plugins/:name/grant", async (c: Context) => {
      const caller = RouteAuth.requireClaim(c, Claims.PluginsGrant);
      const name = c.req.param("name") || "";
      await PluginRoutes.require(service, name);
      const revoked = await service.plugins.revoke(name, PluginRoutes.request(c, caller));
      return c.json(PluginViews.of(revoked));
    });

    /**
     * Turn a plugin off, or back on, for the next start.
     *
     * `plugins:enable` and not `plugins:grant`, because the two are different
     * decisions: withdrawing authority and refusing to load are separate
     * remedies, and an operator who had to re-approve after every pause would
     * learn to approve widely to avoid the trouble.
     *
     * The response says `restart_required` because it is, until phase 4. A
     * management call that silently does nothing until someone happens to
     * restart is the failure §13.3 exists to refuse.
     */
    for (const [verb, enabled] of [
      ["enable", true],
      ["disable", false],
    ] as const) {
      app.post(`/api/plugins/:name/${verb}`, async (c: Context) => {
        const caller = RouteAuth.requireClaim(c, Claims.PluginsEnable);
        const name = c.req.param("name") || "";
        await PluginRoutes.require(service, name);
        const record = await service.plugins.setEnabled(
          name,
          enabled,
          PluginRoutes.request(c, caller)
        );
        return c.json({ ...PluginViews.of(record), restart_required: true });
      });
    }
  }

  /**
   * A plugin with no `_plugins` record has never been loaded, which is a
   * different thing from not existing — so the message says which.
   */
  private static async require(service: SiloService, name: string) {
    const record = await service.plugins.find(name);
    if (!record) {
      throw new NotFoundError(
        `plugin "${name}" has no record on this instance. A record is written the first ` +
          `time a plugin listed in silo.toml is loaded, so either it is not listed or the ` +
          `server has not started since it was added.`
      );
    }
    return record;
  }

  /** The granting key's authority, identity and expected revision, in one
   *  place so no mutation forgets one of the three. */
  private static request(c: Context, caller: AuthenticatedKey): GrantRequest {
    return {
      claims: caller.claims,
      actor: PluginRoutes.actor(caller),
      expectedRev: RouteAuth.getExpectedRev(c),
    };
  }

  private static actor(caller: AuthenticatedKey): AuditActor {
    return caller.id ? AuditUtils.key(caller.id, caller) : { kind: "system" };
  }

  /** An absent body is `{}`. `PUT .../grant` with no body is a meaningful
   *  request — "grant everything asked for" — not a malformed one. */
  private static async body(c: Context): Promise<{ claims?: unknown }> {
    const raw = await c.req.text();
    if (!raw.trim()) return {};
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new ValidationError("invalid body: want {claims: [...]} or no body at all");
      }
      return parsed;
    } catch (caught) {
      if (ValidationError.is(caught)) throw caught;
      throw new ValidationError("invalid JSON body");
    }
  }
}
