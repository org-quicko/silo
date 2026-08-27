import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { SqliteStore } from "../../src/adapters/storage/sqlite/sqlite-store";
import { SiloService } from "../../src/core/services/silo-service";
import { Scope } from "../../src/core/domain/scope";
import { Logger } from "../../src/logging/logger";
import { SiloServer } from "../../src/http/server";
import { ManifestReader, PluginRegistry, PluginSupervisor } from "../../src/plugins";
import type { PluginConfig } from "../../src/config/plugin-config";
import { ConfigLoader } from "../../src/config/config-loader";
import { AuditUtils } from "../../src/core/audit/audit-utils";
import type { Hono } from "hono";

const Fixtures = path.join(import.meta.dir, "fixtures");
const scope = Scope.Default;

function pluginConfig(name: string, over: Partial<PluginConfig> = {}): PluginConfig {
  return { name, claims: [], timeout_ms: 5000, on_error: "fail", config: {}, ...over };
}

/**
 * Plugin-contributed routes under `/api/ext/{name}/*` (D36, phase 6).
 *
 * Two questions run through all of it. **Who may reach a route** — which is
 * `http:route`, `auth`, and the fact that every one of those is read live, so
 * phase 4's revoke and disable mean here what they already mean for hooks. And
 * **what a plugin may reach from one** — which is nothing new, because a handler
 * gets the same `ctx` a hook does, and that is exactly why reaching a route is
 * reaching the plugin's whole grant.
 */
describe("plugin routes (D36)", () => {
  let tempDir: string;
  let store: SqliteStore;
  let service: SiloService;
  let registry: PluginRegistry | null = null;
  let supervisor: PluginSupervisor;
  let app: Hono;
  let rootKey: string;

  const auth = () => ({ Authorization: `Bearer ${rootKey}` });

  /** Boot exactly as `serve` does: load, hand the bus over, build, attach. */
  const load = async (plugins: PluginConfig[]) => {
    for (const plugin of plugins) {
      await fs.cp(path.join(Fixtures, plugin.name), path.join(tempDir, "plugins", plugin.name), {
        recursive: true,
      });
    }
    const config = ConfigLoader.defaultConfig();
    config.storage.path = tempDir;
    config.plugins = plugins;

    registry = await PluginRegistry.load(config, service, Logger.silent());
    service.useHooks(registry.hooks());
    supervisor = new PluginSupervisor({
      registry,
      service,
      logger: Logger.silent(),
      config,
    });
    app = new SiloServer(service, {
      version: "test",
      authDisabled: false,
      logger: Logger.silent(),
      plugins: supervisor,
    }).build();
    registry.attach(app);
    return app;
  };

  /** The greeter, granted everything its manifest asks for. */
  const greeter = (over: Partial<PluginConfig> = {}) =>
    pluginConfig("greeter", {
      claims: [
        "http:route",
        "collections:*/*/*:entries:read",
        "collections:*/*/*:entries:create",
      ],
      config: { collection: "notes" },
      ...over,
    });

  const get = (path: string, init: RequestInit = {}) => app.request(path, init);

  /** A response body, untyped — every one of these is a plugin’s own JSON. */
  const json = async (response: Response): Promise<any> => await response.json();

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-ext-routes-"));
    await fs.mkdir(path.join(tempDir, "plugins"), { recursive: true });
    store = await SqliteStore.open(path.join(tempDir, "test.db"));
    service = new SiloService(store, { mediaDir: path.join(tempDir, "media") });
    rootKey = await service.keys.bootstrap();
    await service.scopes.initDefaults();
    await service.collections.putSchema(scope, "notes", {
      type: "object",
      properties: { title: { type: "string" } },
    });
  });

  afterEach(async () => {
    await registry?.stop();
    registry = null;
    await store.close();
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  describe("who may reach one", () => {
    /** `auth: "public"` is the whole reason it is declared per route and
     *  approved with the rest: no credential is involved at all. */
    test("a public route answers with no credential", async () => {
      await load([greeter()]);

      const response = await get("/api/ext/greeter/hello?who=world");
      expect(response.status).toBe(200);
      const body = await json(response);
      expect(body.greeting).toBe("hello");
      expect(body.query).toEqual({ who: "world" });
      // Nobody is calling, and the plugin is told so rather than being handed a
      // placeholder it might mistake for a principal.
      expect(body.caller).toBeNull();
    });

    test("a key route refuses without one, and answers with one", async () => {
      await load([greeter()]);

      const anonymous = await get("/api/ext/greeter/whoami");
      expect(anonymous.status).toBe(401);

      const authenticated = await get("/api/ext/greeter/whoami", { headers: auth() });
      expect(authenticated.status).toBe(200);
      expect((await json(authenticated)).claims).toEqual(["*"]);
    });

    /**
     * The plugin learns who is calling and never how they proved it.
     *
     * The same rule as `PluginApiDispatcher` stripping these on the way out: a
     * plugin acts with its own authority, so the only use for a caller's secret
     * is to act as them, and a plugin that never holds one cannot log or forward
     * one either.
     */
    test("the caller's credential is withheld from the handler", async () => {
      await load([greeter()]);

      const response = await get("/api/ext/greeter/whoami", {
        headers: { ...auth(), "X-Api-Key": "also-secret", "X-Trace": "kept" },
      });
      const body = await json(response);

      expect(body.headers.authorization).toBeUndefined();
      expect(body.headers["x-api-key"]).toBeUndefined();
      // Not a blanket strip: everything else still arrives.
      expect(body.headers["x-trace"]).toBe("kept");
      expect(body.id).toBeTruthy();
    });
  });

  describe("what a handler can do", () => {
    test("a path parameter binds, and ctx reads with the plugin's grant", async () => {
      await load([greeter()]);
      const entry = await service.entries.create(scope, "notes", { title: "stored" });

      const response = await get(`/api/ext/greeter/notes/${entry.id}`, { headers: auth() });
      const body = await json(response);

      expect(body.id).toBe(entry.id);
      expect(body.status).toBe(200);
      expect(JSON.parse(body.body).title).toBe("stored");
    });

    test("a body arrives, and a write through ctx lands", async () => {
      await load([greeter()]);

      const response = await get("/api/ext/greeter/notes", {
        method: "POST",
        headers: { ...auth(), "Content-Type": "application/json" },
        body: JSON.stringify({ title: "from a route" }),
      });
      expect(response.status).toBe(201);

      const listed = await service.entries.list(scope, "notes", {});
      expect(listed.total).toBe(1);
      expect(listed.items[0]!.data.title).toBe("from a route");
    });

    test("returning nothing is a 204 with no body", async () => {
      await load([greeter()]);

      const response = await get("/api/ext/greeter/gone", {
        method: "DELETE",
        headers: auth(),
      });
      expect(response.status).toBe(204);
      expect(await response.text()).toBe("");
    });

    /**
     * A handler throws and never mentions a status code.
     *
     * `ValidationError` crosses the worker boundary rebuilt by name
     * (`PluginError`), so `SiloServer.onError` maps it exactly as it maps a
     * schema failure or a guard plugin's refusal (§13.9). One error path, not a
     * second one for routes.
     */
    test("a ValidationError from a handler is a 400 with its details", async () => {
      await load([greeter()]);

      const response = await get("/api/ext/greeter/refuse", { headers: auth() });
      expect(response.status).toBe(400);
      const body = await json(response);
      expect(body.error.code).toBe("validation_failed");
      expect(body.error.message).toContain("the greeter refuses");
      expect(body.error.details[0].path).toBe("/");
    });

    test("an ordinary throw is a 500, and does not take the worker with it", async () => {
      await load([greeter()]);

      expect((await get("/api/ext/greeter/boom", { headers: auth() })).status).toBe(500);
      // Still serving: a fault in a handler is not a reason to tear down a
      // plugin, only a missed budget is (§13.9).
      expect((await get("/api/ext/greeter/hello")).status).toBe(200);
    });
  });

  describe("what is not there", () => {
    test("an undeclared path is a 404 and an undeclared method is a 405", async () => {
      await load([greeter()]);

      expect((await get("/api/ext/greeter/nope", { headers: auth() })).status).toBe(404);
      expect((await get("/api/ext/nobody/hello", { headers: auth() })).status).toBe(404);

      const wrong = await get("/api/ext/greeter/hello", { method: "POST", headers: auth() });
      expect(wrong.status).toBe(405);
      // 404 here would send someone reading the manifest looking for a typo in
      // a path that is spelled correctly.
      expect((await json(wrong)).error.code).toBe("method_not_allowed");
    });

    /**
     * `HEAD` is `GET` without content (RFC 9110 §9.3.2), and every silo route
     * already answers it — measured on a running instance, where `/api/health`,
     * `/api/projects` and `/api/plugins` all return 200 to a `HEAD`.
     *
     * A plugin route that answered 405 instead would be the one route on the
     * instance that behaves differently, and the callers that send `HEAD` are
     * caches, proxies, link checkers and uptime monitors rather than anything a
     * plugin author would test.
     */
    test("HEAD reaches a declared GET route, and sends no body", async () => {
      await load([greeter()]);

      const response = await get("/api/ext/greeter/hello", { method: "HEAD" });
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("");
      // Still the GET route's own headers, so a cache learns what it came for.
      expect(response.headers.get("content-type")).toContain("application/json");

      // Not invented for other methods: nothing declares POST /hello.
      expect((await get("/api/ext/greeter/hello", { method: "POST", headers: auth() })).status).toBe(
        405
      );
    });

    /**
     * A plugin's routes are data, so they cannot reach into Hono's matcher.
     *
     * `RouteManager` documents that registration order is load-bearing —
     * `/schema` before `/:id`, `/search` before entries — which is why plugins
     * are never let into that list. This asserts the consequence rather than the
     * mechanism: silo's own routes answer exactly as they did.
     */
    test("a loaded plugin does not shadow silo's own routes", async () => {
      await load([greeter()]);

      expect((await get("/api/projects", { headers: auth() })).status).toBe(200);
      expect((await get("/api/health")).status).toBe(200);
      expect((await get("/api/plugins", { headers: auth() })).status).toBe(200);
    });
  });

  describe("phase 4 applies to routes too", () => {
    /**
     * The property the whole design of `ExtRoutes` exists for: the route table
     * is read per request, through the supervisor, so authority is live.
     *
     * Granted through the **store** rather than through `silo.toml`, because
     * that is the half a revoke can withdraw — see the next test for the other
     * half. An ungranted plugin still loads (it is `pending`, D34), so this also
     * covers a plugin whose routes are declared and reachable by nobody.
     */
    test("granting and revoking http:route open and close the routes, live", async () => {
      await load([greeter({ claims: [] })]);

      // Declared, loaded, granted nothing: the routes exist and refuse.
      const ungranted = await get("/api/ext/greeter/hello");
      expect(ungranted.status).toBe(403);
      expect((await json(ungranted)).error.message).toContain("http:route");

      await supervisor.grant("greeter", ["http:route"], { actor: AuditUtils.cli() });
      expect((await get("/api/ext/greeter/hello")).status).toBe(200);

      await supervisor.revoke("greeter", { actor: AuditUtils.cli() });
      expect((await get("/api/ext/greeter/hello")).status).toBe(403);
    });

    /**
     * A grant written in `silo.toml` survives a revoke, and the routes with it.
     *
     * D34 made effective authority the union of the file and the record, so
     * `DELETE .../grant` clears only what is stored. Pinned here because it is
     * the surprising half — an operator revoking a plugin's routes and watching
     * them keep answering is reading the union correctly, and the grant screen
     * says so in as many words.
     */
    test("a route granted by silo.toml is not closed by a revoke", async () => {
      await load([greeter()]);
      expect((await get("/api/ext/greeter/hello")).status).toBe(200);

      await supervisor.revoke("greeter", { actor: AuditUtils.cli() });
      expect((await get("/api/ext/greeter/hello")).status).toBe(200);
    });

    test("a disabled plugin serves nothing, and enabling brings the routes back", async () => {
      await load([greeter()]);
      const record = await service.plugins.find("greeter");

      await supervisor.setEnabled("greeter", false, {
        actor: AuditUtils.cli(),
        expectedRev: record!.rev,
      });
      // 404 rather than 403: whether a plugin is disabled is the operator's
      // business, and a caller learns only that there is no such route.
      expect((await get("/api/ext/greeter/hello")).status).toBe(404);

      const disabled = await service.plugins.find("greeter");
      await supervisor.setEnabled("greeter", true, {
        actor: AuditUtils.cli(),
        expectedRev: disabled!.rev,
      });
      expect((await get("/api/ext/greeter/hello")).status).toBe(200);
    });
  });

  describe("a route cannot become a loop", () => {
    /**
     * `ctx.fetch` is confined to `/api/`, and `/api/ext/` is inside it — so a
     * plugin can reach its own route, and a one-line handler that calls itself
     * would otherwise recurse. The guard is not a new counter: it is the causal
     * chain D33 already threads, refused here rather than skipped because a
     * request has to answer something.
     */
    test("a plugin calling its own route is refused by the causal chain", async () => {
      await load([greeter()]);

      const response = await get("/api/ext/greeter/loop", { headers: auth() });
      expect(response.status).toBe(200);

      // The outer call succeeded; the inner one it made was refused.
      const body = await json(response);
      expect(body.reached).toBe(403);
      expect(body.body).toContain("its own route");
    });
  });

  describe("a slow handler", () => {
    test("is a 504 naming the remedy, and the plugin is then failed", async () => {
      await load([greeter({ timeout_ms: 300 })]);

      const response = await get("/api/ext/greeter/slow", { headers: auth() });
      expect(response.status).toBe(504);
      const body = await json(response);
      expect(body.error.code).toBe("plugin_unavailable");
      expect(body.error.details.remedy).toBe("POST /api/plugins/greeter/restart");

      // Not silent, which is D39's rule: the worker is gone and the management
      // surface says so rather than the plugin merely stopping.
      const status = registry!.find("greeter")!.status();
      expect(status.state).toBe("failed");
    });
  });

  describe("the manifest", () => {
    const manifest = (silo: Record<string, unknown>) =>
      ManifestReader.validate("x", {
        name: "x",
        silo: { silo: "*", contributes: { ...silo } },
      });

    /**
     * A routes-only plugin is loadable, and before this phase it was not.
     *
     * That refusal is D36's own complaint about `kind`: asking only about hooks
     * made a package that wanted to serve a route invent one merely to be
     * called.
     */
    test("declares routes and no hooks, and still loads", async () => {
      await load([greeter()]);
      expect(registry!.find("greeter")!.hooks).toEqual([]);
      expect((await get("/api/ext/greeter/hello")).status).toBe(200);
    });

    test("a plugin that contributes nothing at all is still refused", () => {
      expect(() => manifest({ hooks: [], routes: [] })).toThrow(/declares nothing/);
    });

    test("auth defaults to key, which is the weaker of the two", () => {
      const read = manifest({ routes: [{ method: "GET", path: "/a" }] });
      expect(read.contributes.routes[0]!.auth).toBe("key");
    });

    test("refuses a path that could reach outside its own namespace", () => {
      const bad = (path: string) => () => manifest({ routes: [{ method: "GET", path }] });

      expect(bad("/*")).toThrow(/wildcard/);
      expect(bad("/a/../b")).toThrow(/".."/);
      expect(bad("relative")).toThrow(/must start with/);
      expect(bad("/a//b")).toThrow(/empty segment/);
      expect(bad("/a?x=1")).toThrow(/query or a fragment/);
      expect(bad("/a/")).toThrow(/must not end with/);
    });

    test("refuses an unknown method, a bad auth, and a duplicate", () => {
      expect(() => manifest({ routes: [{ method: "OPTIONS", path: "/a" }] })).toThrow(/not one of/);
      expect(() =>
        manifest({ routes: [{ method: "GET", path: "/a", auth: "anyone" }] })
      ).toThrow(/must be "key" or "public"/);
      expect(() =>
        manifest({
          routes: [
            { method: "GET", path: "/a" },
            { method: "GET", path: "/a" },
          ],
        })
      ).toThrow(/more than once/);
    });

    /** The same argument as `assertDeliverable`: a plugin whose routes all
     *  answer 403 is running, healthy, and not doing its job — and the failure
     *  would surface to a caller rather than to whoever deployed it. */
    test("declared routes with no http:route refuse the start", async () => {
      const failed = await load([greeter({ claims: ["collections:*/*/*:entries:read"] })]).then(
        () => null,
        (caught: Error) => caught
      );
      expect(failed?.message).toMatch(/declares 9 routes/);
      expect(failed?.message).toContain('"http:route"');
    });
  });
});
