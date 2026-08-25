import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { Hono } from "hono";
import { SqliteStore } from "../../src/adapters/storage/sqlite/sqlite-store";
import { SiloService } from "../../src/core/services/silo-service";
import { Scope } from "../../src/core/domain/scope";
import { Logger } from "../../src/logging/logger";
import { SiloServer } from "../../src/http/server";
import { PluginRegistry } from "../../src/plugins";
import type { PluginConfig } from "../../src/config/plugin-config";
import { ConfigLoader } from "../../src/config/config-loader";

const Fixtures = path.join(import.meta.dir, "fixtures");
const scope = Scope.Default;

/** The claims that let a plugin be **delivered** a hook anywhere (D34). */
function deliver(...hooks: string[]): string[] {
  return hooks.map((hook) => `hooks:*/*/*:${hook}`);
}

function pluginConfig(name: string, over: Partial<PluginConfig> = {}): PluginConfig {
  return { name, claims: [], timeout_ms: 5000, on_error: "fail", config: {}, ...over };
}

/**
 * `ctx` as the HTTP API, dispatched in-process (D35, phase 3).
 *
 * Every assertion here is really about **who decides**. Before this, a plugin's
 * reach was five methods with a hand-rolled claim check; now it is a request
 * against the same Hono app a network request hits, so the answer comes from
 * `AuthMiddleware` and `RouteAuth` — and the interesting cases are the ones
 * where that could quietly stop being true.
 */
describe("ctx.fetch (D35)", () => {
  let tempDir: string;
  let store: SqliteStore;
  let service: SiloService;
  let registry: PluginRegistry | null = null;

  /**
   * A route that never answers, in front of the real app.
   *
   * Composed rather than registered onto the silo app because `SiloServer`
   * mounts a catch-all last and Hono matches in registration order, so anything
   * added afterwards would never be reached.
   */
  const withHang = (silo: Hono): Hono => {
    const app = new Hono();
    app.get("/api/hang", () => new Promise<Response>(() => {}));
    app.all("/*", (c) => silo.fetch(c.req.raw, c.env));
    return app;
  };

  const load = async (
    plugins: PluginConfig[],
    options: { authDisabled?: boolean; hang?: boolean } = {}
  ) => {
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

    const silo = new SiloServer(service, {
      version: "test",
      authDisabled: options.authDisabled ?? false,
      logger: Logger.silent(),
    }).build();
    registry.attach(options.hang ? withHang(silo) : silo);
    return silo;
  };

  /**
   * Drive the loaded plugin once and read what it saw.
   *
   * `entry.beforeValidate` is the one hook that may rewrite the value, so a
   * fixture can report its answer by storing it — which is how a probe made
   * inside a worker becomes something a test can assert on without a channel of
   * its own.
   */
  const probe = async (): Promise<any> => {
    const entry = await service.entries.create(scope, "probes", { title: "probe" });
    return JSON.parse(String(entry.data.note));
  };

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-ctx-fetch-"));
    store = await SqliteStore.open(path.join(tempDir, "test.db"));
    service = new SiloService(store, { mediaDir: path.join(tempDir, "media") });
    await service.scopes.initDefaults();
    await service.collections.putSchema(scope, "probes", {
      type: "object",
      properties: { title: { type: "string" }, note: { type: "string" } },
    });
    await service.collections.putSchema(scope, "posts", {
      type: "object",
      properties: { title: { type: "string" } },
    });
    await service.collections.putSchema(scope, "secrets", {
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

  describe("the route is the guard", () => {
    test("a granted collection answers, and a neighbouring one does not", async () => {
      // Seeded before the plugin loads, so the fixture's own hook does not run
      // against the rows it is later asked to count.
      await service.entries.create(scope, "posts", { title: "one" });
      await service.entries.create(scope, "posts", { title: "two" });

      await load([
        pluginConfig("lister", {
          claims: [
            ...deliver("entry.beforeValidate"),
            `collections:${scope.project}/${scope.env}/posts:entries:read`,
          ],
          config: { from: "posts" },
        }),
      ]);

      expect(await probe()).toEqual({ total: 2 });
    }, 30000);

    test("the refusal is the route's, in the route's own words", async () => {
      await load([
        pluginConfig("prober", {
          claims: deliver("entry.beforeValidate"),
          config: { path: "/api/keys" },
        }),
      ]);

      const seen = await probe();
      expect(seen.status).toBe(403);
      // Not a message this file invented: `RouteAuth.requireClaim` wrote it, and
      // a plugin now gets the sentence a key would, in the same envelope.
      expect(JSON.parse(seen.body).error).toEqual({
        code: "forbidden",
        message: 'this key is missing claim "keys:read"',
      });
    }, 30000);

    test("the typed client throws where the raw fetch reports", async () => {
      await load([
        pluginConfig("lister", {
          claims: [
            ...deliver("entry.beforeValidate"),
            `collections:${scope.project}/${scope.env}/posts:entries:read`,
          ],
          config: { from: "secrets" },
        }),
      ]);

      // Granted `posts` and asked for `secrets`: the 403 the route returned
      // becomes a ForbiddenError, which is exactly what the five hand-written
      // methods used to throw directly.
      expect(await probe()).toEqual({ threw: "ForbiddenError" });
    }, 30000);

    test("a 404 is an answer, not a throw", async () => {
      await load([
        pluginConfig("prober", {
          claims: [
            ...deliver("entry.beforeValidate"),
            `collections:${scope.project}/${scope.env}/posts:entries:read`,
          ],
          config: {
            path: `/api/projects/${scope.project}/environments/${scope.env}/collections/posts/01JJJJJJJJJJJJJJJJJJJJJJJJ`,
          },
        }),
      ]);

      const seen = await probe();
      expect(seen.status).toBe(404);
      expect(seen.threw).toBeUndefined();
    }, 30000);
  });

  describe("what a plugin reads is what the API returns", () => {
    test("a media reference is not rewritten against a host that does not exist", async () => {
      await service.collections.putSchema(scope, "assets", {
        type: "object",
        properties: {
          title: { type: "string" },
          hero: { type: "string", "x-silo-type": "media" },
        },
      });
      // A real asset, because a reference to one that does not exist is refused
      // at write time (D23) — the reference has to be genuine for the read to
      // reach the resolver at all.
      const asset = await service.media.save("hero.txt", new Uint8Array([1, 2, 3]), "text/plain");
      const stored = await service.entries.create(scope, "assets", {
        title: "a",
        hero: `silo://media/${asset.id}`,
      });

      await load([
        pluginConfig("prober", {
          claims: [
            ...deliver("entry.beforeValidate"),
            `collections:${scope.project}/${scope.env}/assets:entries:read`,
          ],
          config: {
            path: `/api/projects/${scope.project}/environments/${scope.env}/collections/assets/${stored.id}`,
          },
        }),
      ]);

      // A dispatched request has no public origin — nothing about a plugin's
      // call says where this instance is reachable — so the route must not
      // invent one. The stored reference is what a plugin saw before D35 and
      // what it still sees: an id it can compare, not a URL rooted at a
      // hostname that resolves nowhere.
      const seen = await probe();
      expect(JSON.parse(seen.body).hero).toBe(`silo://media/${asset.id}`);
    }, 30000);
  });

  /**
   * D37's fifth finding, closed.
   *
   * `--no-auth` gives every request `["*"]`, which is right for what it means
   * and becomes wrong the moment `ctx` dispatches through the same middleware:
   * every plugin on every development instance would silently hold root, which
   * is precisely where plugins are written and tested.
   */
  describe("--no-auth does not reach plugins (D37 F5)", () => {
    test("a plugin granted nothing is still refused on an instance with auth off", async () => {
      const app = await load(
        [
          pluginConfig("prober", {
            claims: deliver("entry.beforeValidate"),
            config: { path: "/api/keys" },
          }),
        ],
        { authDisabled: true }
      );

      // The branch is still doing its job for a real request...
      expect((await app.request("/api/keys")).status).toBe(200);

      // ...and the plugin, on the same instance, is bounded by its grant.
      expect((await probe()).status).toBe(403);
    }, 30000);
  });

  describe("confinement to /api/ (phase 3, requirement 2)", () => {
    const outside = [
      ["the media byte route", "/media/01JJJJJJJJJJJJJJJJJJJJJJJJ"],
      ["the SPA fallback", "/"],
      ["an asset", "/assets/index.js"],
      ["a path that is really an authority", "//example.com/api/projects"],
      ["a traversal out of /api/", "/api/../media/01JJJJJJJJJJJJJJJJJJJJJJJJ"],
      ["an absolute URL", "http://example.com/api/projects"],
    ] as const;

    for (const [what, target] of outside) {
      test(`${what} is refused`, async () => {
        await load([
          pluginConfig("prober", {
            claims: deliver("entry.beforeValidate"),
            config: { path: target },
          }),
        ]);

        expect((await probe()).threw).toContain("may only reach /api/");
      }, 30000);
    }

    test("inside it, an unauthenticated route still answers", async () => {
      // The boundary is a prefix, not a deny-list: `/api/health` is reachable
      // because it is under /api/, and nothing about it needed naming.
      await load([
        pluginConfig("prober", {
          claims: deliver("entry.beforeValidate"),
          config: { path: "/api/health" },
        }),
      ]);

      expect((await probe()).status).toBe(200);
    }, 30000);

    test("the system scope stays unaddressable", async () => {
      await load([
        pluginConfig("prober", {
          claims: deliver("entry.beforeValidate"),
          config: { path: "/api/projects/_system/environments/_system/collections/_keys" },
        }),
      ]);

      // `Scope.of` refuses a `_`-prefixed id, which is the single boundary that
      // makes "a plugin is an API key with code attached" safe to say (D37).
      expect((await probe()).status).toBe(400);
    }, 30000);
  });

  describe("the channel is the credential", () => {
    test("an Authorization header a plugin sets authenticates nothing", async () => {
      const root = await service.keys.bootstrap();

      await load([
        pluginConfig("prober", {
          claims: deliver("entry.beforeValidate"),
          config: { path: "/api/keys", headers: { Authorization: `Bearer ${root}` } },
        }),
      ]);

      // The root secret is a real, working credential — presented over a socket
      // this returns 200. Through `ctx` the principal is attached beside the
      // request, so the header is inert and the grant decides.
      expect((await probe()).status).toBe(403);
    }, 30000);
  });

  describe("the causal chain crosses the dispatch (phase 3, requirement 3)", () => {
    test("a plugin writing into the collection it hooks is not re-entered", async () => {
      await load([
        pluginConfig("selfwriter", {
          claims: [
            ...deliver("entry.afterWrite"),
            `collections:${scope.project}/${scope.env}/posts:entries:create`,
          ],
        }),
      ]);

      const started = Date.now();
      await service.entries.create(scope, "posts", { title: "original" });

      // One write and one echo. Before D35 the chain was handed straight to
      // `EntryService`; it now rides an injected principal across an HTTP
      // request, and if it were dropped this would recurse to `HookBus.MaxDepth`
      // — which is a count *and* a clock, so assert both.
      const listed = await service.entries.list(scope, "posts", {});
      expect(listed.total).toBe(2);
      expect(Date.now() - started).toBeLessThan(5000);
    }, 30000);
  });

  /**
   * D37's fourth requirement for this phase.
   *
   * `WorkerHost` kills a worker permanently on a dispatch timeout and phase 4's
   * supervisor does not exist yet, so the difference between bounding the call
   * and bounding only the dispatch is the difference between a plugin that can
   * catch a slow route and a plugin that never runs again.
   */
  describe("a slow call is the call's problem, not the worker's", () => {
    test("the fetch rejects, the hook completes, and the worker survives", async () => {
      await load(
        [
          pluginConfig("prober", {
            claims: deliver("entry.beforeValidate"),
            timeout_ms: 1200,
            config: { path: "/api/hang" },
          }),
        ],
        { hang: true }
      );

      const started = Date.now();
      const seen = await probe();
      const elapsed = Date.now() - started;

      expect(seen.threw).toContain("exceeded");
      // Inside the dispatch budget, which is what says the *call* timed out
      // rather than the worker being torn down for the dispatch.
      expect(elapsed).toBeLessThan(1200);

      // The proof that it was not torn down: it answers again.
      const again = await service.entries.create(scope, "probes", { title: "after" });
      expect(String(again.data.note)).toContain("exceeded");
    }, 30000);
  });
});
