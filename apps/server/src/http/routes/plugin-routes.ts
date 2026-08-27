import type { Context } from "hono";
import { Claims } from "@silo/shared/claims";
import { PluginGrantUtils } from "../../core/plugins/plugin-grant-utils";
import { ValidationError } from "@silo/shared/validation-error";
import type { SiloService } from "../../core/services/silo-service";
import type { AuditActor } from "../../core/audit/audit-actor";
import { AuditUtils } from "../../core/audit/audit-utils";
import type { AuthenticatedKey } from "../../core/keys/authenticated-key";
import type { PluginGrantRecord } from "../../core/plugins/plugin-grant-record";
import type { GrantRequest } from "../../core/services/support/grant-request";
import { NotFoundError } from "../../core/errors/not-found-error";
import type { PluginSupervisor } from "../../plugins";
import { RouteAuth } from "../auth/route-auth";
import { PluginViews } from "./plugin-view";

/**
 * `/api/plugins/*` — the management surface D31 reserved this namespace for,
 * D34 redirected it to, D38 built and D39 made take effect.
 *
 * It manages **grants and lifecycle**, not packages. Everything except `rescan`
 * reads and writes the `_plugins` record, and `rescan` reaches the filesystem
 * only to re-read the operator's *own* `silo.toml` — which keeps D34's split
 * intact: an API that could add a `[[plugins]]` block would be a code-execution
 * primitive wearing a management claim, while one that applies a block the
 * operator already wrote runs exactly what a restart would have.
 *
 * Every mutation that changes a record is fenced with `If-Match`. On a grant
 * that is not ceremony: approving means approving **what you read**, and a
 * package whose request changed between the read and the approval is exactly
 * the substitution `needs_review` exists to catch. `restart` and `rescan` are
 * the two that are not fenced, and for the same reason as each other — neither
 * writes a record, so there is no revision anybody could be approving.
 */
export class PluginRoutes {
  static register(app: any, service: SiloService, supervisor: PluginSupervisor) {
    /**
     * Re-read `silo.toml` and make the running set match it.
     *
     * Registered before `/:name` so the literal wins if a `POST` verb is ever
     * added at that depth — a plugin genuinely named `rescan` would otherwise
     * become unroutable, which is the collision D34 moved plugin routes to
     * `/api/ext/` to avoid in the first place.
     *
     * `plugins:enable`, because rescan is enable and disable applied to the
     * whole set, and "may this caller decide whether plugin code runs" should
     * have one answer rather than two.
     */
    app.post("/api/plugins/rescan", async (c: Context) => {
      RouteAuth.requireClaim(c, Claims.PluginsEnable);
      return c.json(await supervisor.rescan());
    });

    app.get("/api/plugins", async (c: Context) => {
      RouteAuth.requireClaim(c, Claims.PluginsRead);
      const records = await service.plugins.list();
      const items = [];
      for (const record of records) items.push(await PluginRoutes.view(supervisor, record));
      return c.json({ items });
    });

    /**
     * One plugin's declared admin panel (D41).
     *
     * Registered before `/:name` for the same reason `rescan` is, and behind
     * `plugins:read` because that is already the claim for looking at a plugin —
     * a panel is a *rendering* of what this surface reports, not new reach.
     *
     * **The headers are the security property, not decoration.** The API and the
     * admin SPA are served from one origin (D26 embeds the SPA in the binary),
     * and the admin keeps `silo_servers` in that origin's `localStorage` — an API
     * key for every instance the operator has configured. A plugin's HTML
     * rendered as a document here would therefore be able to read a credential
     * for every silo the operator has ever connected to, which is a strictly
     * larger authority than anything a plugin can be granted. So the bytes leave
     * as JSON, `nosniff` forbids a browser inferring otherwise, and the CSP is
     * there for the case this is opened directly with a client that ignores both.
     * Only the admin turns a panel into a document, in a sandboxed iframe with no
     * origin of its own.
     */
    app.get("/api/plugins/:name/ui", async (c: Context) => {
      RouteAuth.requireClaim(c, Claims.PluginsRead);
      const name = c.req.param("name") || "";
      // The record is required first, so a package with a panel but no record
      // answers the same "has never been loaded" message every other verb gives
      // rather than rendering a screen for a plugin the instance has not adopted.
      await PluginRoutes.require(service, name);
      const panel = await supervisor.panel(name);

      c.header("X-Content-Type-Options", "nosniff");
      c.header("Content-Security-Policy", "default-src 'none'; sandbox");
      c.header("Cache-Control", "no-store");
      return c.json(panel);
    });

    app.get("/api/plugins/:name", async (c: Context) => {
      RouteAuth.requireClaim(c, Claims.PluginsRead);
      const record = await PluginRoutes.require(service, c.req.param("name") || "");
      const view = await PluginRoutes.view(supervisor, record);
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
     * An omitted `claims` means everything the package says it **requires** — the
     * same default `silo plugin grant` takes, for the same reason: approving what
     * a plugin needs is the common case and going further, or narrower, is the
     * deliberate one. It read `requested` before D36 split the two, which is the
     * same answer for a package declaring nothing optional and the wrong one for
     * a package that does: a default that approved the optional half would make
     * the word mean nothing.
     *
     * From the record, never the manifest — that is D38's rule for this whole
     * surface, and it is why `required` is stored beside `requested`.
     */
    app.put("/api/plugins/:name/grant", async (c: Context) => {
      const caller = RouteAuth.requireClaim(c, Claims.PluginsGrant);
      const name = c.req.param("name") || "";
      const record = await PluginRoutes.require(service, name);
      const body = await PluginRoutes.body(c);

      const claims =
        body.claims === undefined
          ? PluginGrantUtils.requiredOf(record)
          : Claims.normalize(body.claims as string[]);
      const granted = await supervisor.grant(name, claims, PluginRoutes.request(c, caller));
      return c.json(await PluginRoutes.view(supervisor, granted));
    });

    app.delete("/api/plugins/:name/grant", async (c: Context) => {
      const caller = RouteAuth.requireClaim(c, Claims.PluginsGrant);
      const name = c.req.param("name") || "";
      await PluginRoutes.require(service, name);
      const revoked = await supervisor.revoke(name, PluginRoutes.request(c, caller));
      return c.json(await PluginRoutes.view(supervisor, revoked));
    });

    /**
     * Turn a plugin off, or back on — now, not at the next start (D39).
     *
     * `plugins:enable` and not `plugins:grant`, because the two are different
     * decisions: withdrawing authority and refusing to load are separate
     * remedies, and an operator who had to re-approve after every pause would
     * learn to approve widely to avoid the trouble.
     *
     * The response used to carry `restart_required: true`, because it was. It
     * now carries `runtime`, which says what actually happened — including the
     * cases where nothing came up, such as a record whose plugin `silo.toml`
     * does not list.
     */
    for (const [verb, enabled] of [
      ["enable", true],
      ["disable", false],
    ] as const) {
      app.post(`/api/plugins/:name/${verb}`, async (c: Context) => {
        const caller = RouteAuth.requireClaim(c, Claims.PluginsEnable);
        const name = c.req.param("name") || "";
        await PluginRoutes.require(service, name);
        const record = await supervisor.setEnabled(
          name,
          enabled,
          PluginRoutes.request(c, caller)
        );
        return c.json(await PluginRoutes.view(supervisor, record));
      });
    }

    /**
     * Change, or drop, what a plugin is configured with.
     *
     * `PATCH` with an [RFC 7396](https://www.rfc-editor.org/rfc/rfc7396) merge
     * patch, so one setting can be changed without restating the block and
     * `null` removes one. `DELETE` clears the override and returns the plugin to
     * `silo.toml`'s block — the only way out of the pin an override creates, and
     * the reason there is a second verb here at all.
     *
     * `plugins:configure`, which D34 defined and nothing has used until now.
     */
    app.patch("/api/plugins/:name/config", async (c: Context) => {
      const caller = RouteAuth.requireClaim(c, Claims.PluginsConfigure);
      const name = c.req.param("name") || "";
      await PluginRoutes.require(service, name);

      const patch = await PluginRoutes.body(c);
      const record = await supervisor.configure(name, patch, PluginRoutes.request(c, caller));
      return c.json(await PluginRoutes.view(supervisor, record));
    });

    app.delete("/api/plugins/:name/config", async (c: Context) => {
      const caller = RouteAuth.requireClaim(c, Claims.PluginsConfigure);
      const name = c.req.param("name") || "";
      await PluginRoutes.require(service, name);
      const record = await supervisor.clearConfig(name, PluginRoutes.request(c, caller));
      return c.json(await PluginRoutes.view(supervisor, record));
    });

    /**
     * Bring a dead worker back.
     *
     * A plugin that missed its dispatch budget or crashed is torn down and
     * deliberately not respawned (§13.9) — until phase 4 that kill was also
     * permanent and silent. `runtime` on the view is what made it visible, and
     * this is what makes it recoverable, without demoting the decision to an
     * automatic retry that would walk into the same wall.
     */
    app.post("/api/plugins/:name/restart", async (c: Context) => {
      RouteAuth.requireClaim(c, Claims.PluginsEnable);
      const name = c.req.param("name") || "";
      await PluginRoutes.require(service, name);
      return c.json(await supervisor.restart(name));
    });
  }

  /** The record plus everything only the supervisor knows: whether it is
   *  running, what its package declares, and which config source won. */
  private static async view(supervisor: PluginSupervisor, record: PluginGrantRecord) {
    return PluginViews.of(record, await supervisor.inspect(record.name, record));
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
          `server has not started since it was added. POST /api/plugins/rescan reads the ` +
          `file again without one.`
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

  /**
   * An absent body is `{}`.
   *
   * `PUT .../grant` with no body is a meaningful request — "grant everything
   * asked for" — not a malformed one, and an empty merge patch is a well-formed
   * no-op. A non-object is refused rather than applied: as a merge patch it
   * would replace the whole config document with a scalar, which no manifest
   * schema can accept, so the refusal here is the one that can explain itself.
   */
  private static async body(c: Context): Promise<Record<string, unknown>> {
    const raw = await c.req.text();
    if (!raw.trim()) return {};
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new ValidationError("invalid body: want a JSON object, or no body at all");
      }
      return parsed;
    } catch (caught) {
      if (ValidationError.is(caught)) throw caught;
      throw new ValidationError("invalid JSON body");
    }
  }
}
