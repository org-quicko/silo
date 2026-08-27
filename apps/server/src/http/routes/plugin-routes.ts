import fs from "fs/promises";
import path from "path";
import os from "os";
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
import type { PluginInstallOptions, PluginSupervisor } from "../../plugins";
import { RouteAuth } from "../auth/route-auth";
import { PluginViews } from "./plugin-view";

/**
 * `/api/plugins/*` — the management surface D31 reserved this namespace for,
 * D34 redirected it to, D38 built and D39 made take effect.
 *
 * It manages **grants and lifecycle**, and — since D42 — packages. Most verbs
 * here read and write the `_plugins` record only. `rescan` re-reads the
 * operator's *own* `silo.toml`, and `install` writes to it.
 *
 * D34 declined to write that file from an API, on the argument that doing so is
 * a code-execution primitive wearing a management claim. The argument was
 * right and the conclusion has been overtaken: `rescan` starts arbitrary listed
 * code already, so `plugins:enable` *is* that primitive, and an operator forced
 * to a shell to install a plugin was being protected from nothing. What D34's
 * split still buys is the part that matters — the block `install` writes
 * carries **no claims**, so authority stays in the record where
 * `assertGrantable`, `canDelegate` and the audit trail can see it, and where
 * `DELETE .../grant` can take it back. See `PluginInstallation`.
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
     * Install a package and adopt it, without a restart or a shell (D42).
     *
     * Registered before `/:name` so the literal wins, like `rescan`.
     *
     * `plugins:enable`, and the choice is the whole security argument. This is
     * the one verb on this surface that *writes* a `[[plugins]]` block, which
     * D34 called a code-execution primitive wearing a management claim — and it
     * is, so it is given the claim that already decides whether plugin code
     * runs. `rescan` has been able to start arbitrary listed code since D39;
     * splitting a second claim off for install would suggest a boundary that is
     * not there. What install must never do is *widen* the caller, and that is
     * `PluginInstallation`'s job: the block it writes carries no claims, and
     * every claim goes through the record's own delegation checks first.
     *
     * Two bodies, one shape. A JSON body names a spec; a multipart body may
     * carry an archive instead, which is written to a temp file and installed
     * as a `tarball` source — so an upload and a URL take the identical path
     * through `PluginInstaller`, integrity check included.
     */
    app.post("/api/plugins/install", async (c: Context) => {
      const caller = RouteAuth.requireClaim(c, Claims.PluginsEnable);
      const upload = await PluginRoutes.upload(c);

      try {
        const outcome = await supervisor.install(upload.options, {
          claims: caller.claims,
          actor: PluginRoutes.actor(caller),
        });

        // A package contributing only providers has no record to view — it has
        // no worker to authorize (§13.7). Reporting the install and the reason
        // beats a view of a record that was never written.
        const view = outcome.record
          ? await PluginRoutes.view(supervisor, outcome.record)
          : { name: outcome.name, state: null, runtime: null };
        return c.json({ ...view, warnings: outcome.warnings }, 201);
      } finally {
        await upload.cleanup();
      }
    });

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

  /**
   * The largest archive an install will accept into memory.
   *
   * `formData()` buffers, so this is a real ceiling rather than a policy: a
   * plugin is source and a manifest, and 64 MiB is already far past any package
   * that resolution rule (§13.3) is meant to serve. Checked from
   * `Content-Length` before the body is read *and* from the part's own size
   * after, because the first is a claim the client makes and the second is what
   * arrived.
   */
  private static readonly MaxArchiveBytes = 64 * 1024 * 1024;

  /**
   * The install options, from either body shape, plus the cleanup that has to
   * run whether the install succeeded or not.
   *
   * One parser rather than one per shape: the two differ only in where `spec`
   * comes from, and the copy that stated every other field twice had already
   * started to drift — `timeout_ms` was `Number(...)` on one side, unvalidated,
   * and typed on the other.
   */
  private static async upload(
    c: Context
  ): Promise<{ options: PluginInstallOptions; cleanup: () => Promise<void> }> {
    const noop = async () => {};
    if (!(c.req.header("content-type") || "").includes("multipart/form-data")) {
      const body = await PluginRoutes.body(c);
      if (typeof body.spec !== "string" || !body.spec.trim()) {
        throw new ValidationError("plugin spec is required");
      }
      return { options: PluginRoutes.options(body.spec, body), cleanup: noop };
    }

    const declared = Number(c.req.header("content-length"));
    if (Number.isFinite(declared) && declared > PluginRoutes.MaxArchiveBytes) {
      throw new ValidationError(
        `the upload is ${declared} bytes, over the ${PluginRoutes.MaxArchiveBytes}-byte limit ` +
          `for a plugin archive. Install it from a URL or an npm spec instead.`
      );
    }

    const form = await c.req.formData();
    const fields = Object.fromEntries(
      [...form.entries()].filter(([, value]) => typeof value === "string")
    ) as Record<string, string>;
    const file = form.get("file");

    if (!(file instanceof File)) {
      if (typeof fields.spec === "string" && fields.spec.trim()) {
        return { options: PluginRoutes.options(fields.spec, fields), cleanup: noop };
      }
      throw new ValidationError("missing file or plugin spec in form data");
    }

    if (file.size > PluginRoutes.MaxArchiveBytes) {
      throw new ValidationError(
        `"${file.name}" is ${file.size} bytes, over the ${PluginRoutes.MaxArchiveBytes}-byte ` +
          `limit for a plugin archive. Install it from a URL or an npm spec instead.`
      );
    }

    // Named `.tgz` regardless of what the part was called: the extension is what
    // `SourceParser` reads to choose a fetcher, and a client that uploaded
    // `plugin.bin` should still get the tarball path rather than a confusing
    // refusal about an unrecognised spec.
    const staging = await fs.mkdtemp(path.join(os.tmpdir(), "silo-install-upload-"));
    const archive = path.join(staging, "plugin.tgz");
    await fs.writeFile(archive, new Uint8Array(await file.arrayBuffer()));

    return {
      options: PluginRoutes.options(archive, fields),
      cleanup: async () => {
        await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
      },
    };
  }

  /**
   * One field reader for both body shapes.
   *
   * `claims` is the only field that differs in kind: JSON carries an array, a
   * form carries a comma-separated string. Absent in either form means absent —
   * not empty — because "grant nothing" and "grant what the package requires"
   * are different requests and `PluginInstallation` distinguishes them.
   */
  private static options(spec: string, source: Record<string, unknown>): PluginInstallOptions {
    const text = (key: string): string | undefined => {
      const value = source[key];
      return typeof value === "string" && value.trim() ? value.trim() : undefined;
    };

    const claims = source.claims;
    const timeout = Number(source.timeout_ms);

    return {
      spec: spec.trim(),
      ref: text("ref"),
      integrity: text("integrity"),
      registry: text("registry"),
      force: source.force === true || source.force === "true" || source.force === "1",
      claims: Array.isArray(claims)
        ? claims.map(String)
        : typeof claims === "string" && claims.trim()
          ? claims.split(",").map((claim) => claim.trim()).filter(Boolean)
          : undefined,
      timeout_ms: Number.isFinite(timeout) && timeout > 0 ? timeout : undefined,
      on_error:
        source.on_error === "skip" || source.on_error === "fail" ? source.on_error : undefined,
    };
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
