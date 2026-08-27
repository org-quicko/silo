import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { SqliteStore } from "../../src/adapters/storage/sqlite/sqlite-store";
import { SiloService } from "../../src/core/services/silo-service";
import { Scope } from "../../src/core/domain/scope";
import { Logger } from "../../src/logging/logger";
import { SiloServer } from "../../src/http/server";
import {
  ManifestReader,
  PluginRegistry,
  PluginRouteBodies,
  PluginSupervisor,
} from "../../src/plugins";
import type { PluginRoute } from "../../src/plugins";
import { PluginGrantUtils } from "../../src/core/plugins/plugin-grant-utils";
import type { PluginConfig } from "../../src/config/plugin-config";
import { ConfigLoader } from "../../src/config/config-loader";
import type { Hono } from "hono";

const Fixtures = path.join(import.meta.dir, "fixtures");
const scope = Scope.Default;

function pluginConfig(name: string, over: Partial<PluginConfig> = {}): PluginConfig {
  return { name, claims: [], timeout_ms: 5000, on_error: "fail", config: {}, ...over };
}

/** A `silo` block with the fixture's shape, for the manifest-reading tests. */
function manifest(over: Record<string, unknown> = {}): any {
  return {
    name: "x",
    silo: {
      silo: "*",
      contributes: { routes: [{ method: "POST", path: "/upload" }] },
      permissions: {},
      ...over,
    },
  };
}

/**
 * D41: a route may be handed **bytes**, a package may contribute an admin
 * **panel**, and the route surface joins the manifest digest.
 *
 * The three are one decision rather than three, because each of them exists only
 * because of the others. A plugin that ingests a file needs bytes; a destructive
 * importer needs a screen; and a screen is only safe to build if the operator
 * approving `http:route` can see how large a body each route accepts and whether
 * any of them is public — which the digest is what makes stay true across an
 * upgrade.
 */
describe("bytes, panels and the route digest (D41)", () => {
  let tempDir: string;
  let store: SqliteStore;
  let service: SiloService;
  let registry: PluginRegistry | null = null;
  let supervisor: PluginSupervisor;
  let app: Hono;
  let rootKey: string;

  const auth = () => ({ Authorization: `Bearer ${rootKey}` });

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
    supervisor = new PluginSupervisor({ registry, service, logger: Logger.silent(), config });
    app = new SiloServer(service, {
      version: "test",
      authDisabled: false,
      logger: Logger.silent(),
      plugins: supervisor,
    }).build();
    registry.attach(app);
    await registry.activate();
    return app;
  };

  const scanner = (over: Partial<PluginConfig> = {}) =>
    pluginConfig("scanner", {
      claims: [
        "http:route",
        "collections:*/*/*:entries:create",
        "hooks:*/*/*:entry.afterWrite",
      ],
      ...over,
    });

  const json = async (response: Response): Promise<any> => await response.json();

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-d41-"));
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

  describe("a route that takes bytes", () => {
    /**
     * The whole point: the bytes arrive as they were sent.
     *
     * A SQLite file starts `SQLite format 3\0`, and byte 0x00 is what a UTF-8
     * decode would have destroyed — so this asserts the head rather than the
     * length alone. Before D41 this route could not exist: every body was decoded
     * as text, and a 1.6 MB database was over the one global mebibyte anyway.
     */
    test("hands the handler the exact bytes, and no text", async () => {
      await load([scanner()]);
      const payload = new Uint8Array([0x53, 0x51, 0x4c, 0x00, 0xff, 0xfe]);

      const response = await app.request("/api/ext/scanner/bytes", {
        method: "POST",
        headers: auth(),
        body: payload,
      });

      expect(response.status).toBe(200);
      const body = await json(response);
      expect(body.length).toBe(6);
      expect(body.head).toEqual([0x53, 0x51, 0x4c, 0x00]);
      // Exactly one of the two fields is ever filled, which is why they are two
      // nullable fields rather than one union a handler has to narrow.
      expect(body.body).toBeNull();
    });

    /** The default is unchanged, so nothing written before D41 behaves
     *  differently. */
    test("a route that declares no body still gets text", async () => {
      await load([scanner()]);

      const response = await app.request("/api/ext/scanner/text", {
        method: "POST",
        headers: auth(),
        body: "plain",
      });

      const body = await json(response);
      expect(body.body).toBe("plain");
      expect(body.bytes).toBeNull();
    });

    /**
     * Refused past the cap, and the refusal names the **route's** number.
     *
     * Refused rather than truncated for D36's reason, which bytes do not change:
     * a plugin cannot tell a body it was not given from one that was never sent,
     * so a caller would otherwise get a 200 describing work done on the wrong
     * input.
     */
    test("refuses a body past the route's own cap", async () => {
      await load([scanner()]);

      const ok = await app.request("/api/ext/scanner/small", {
        method: "POST",
        headers: auth(),
        body: new Uint8Array(8),
      });
      expect((await json(ok)).length).toBe(8);

      const refused = await app.request("/api/ext/scanner/small", {
        method: "POST",
        headers: auth(),
        body: new Uint8Array(9),
      });
      expect(refused.status).toBe(400);
      expect((await json(refused)).error.message).toContain("at most 8");
    });

    test("the cap a route declares is on the wire, so a grant screen can show it", async () => {
      await load([scanner()]);

      const response = await app.request("/api/plugins/scanner", { headers: auth() });
      const routes = (await json(response)).contributes.routes;

      expect(routes.find((route: any) => route.path === "/bytes").body).toEqual({
        kind: "bytes",
        max_bytes: 4 * 1024 * 1024,
      });
      // And a route that declared nothing carries D36's behaviour explicitly,
      // rather than an absent field every reader would have to default.
      expect(routes.find((route: any) => route.path === "/text").body).toEqual(
        PluginRouteBodies.Default
      );
    });
  });

  describe("what the manifest refuses", () => {
    test("a body over silo's ceiling, however much the author asks for", () => {
      expect(() =>
        ManifestReader.validate(
          "x",
          manifest({
            contributes: {
              routes: [
                {
                  method: "POST",
                  path: "/upload",
                  body: { kind: "bytes", max_bytes: PluginRouteBodies.Ceiling + 1 },
                },
              ],
            },
          })
        )
      ).toThrow(/silo accepts at most 64 MiB/);
    });

    /** A `GET` carries no body, so declaring one says nothing that could take
     *  effect — and an author debugging a handler always handed nothing would
     *  never suspect the manifest. */
    test("a body on a GET", () => {
      expect(() =>
        ManifestReader.validate(
          "x",
          manifest({
            contributes: {
              routes: [{ method: "GET", path: "/upload", body: { kind: "bytes" } }],
            },
          })
        )
      ).toThrow(/GET carries none/);
    });

    test("an unknown body kind", () => {
      expect(() =>
        ManifestReader.validate(
          "x",
          manifest({
            contributes: {
              routes: [{ method: "POST", path: "/upload", body: { kind: "base64" } }],
            },
          })
        )
      ).toThrow(/must be one of text, bytes/);
    });

    /**
     * A panel path that climbs out of the package.
     *
     * The hazard is not the plugin reading its own files — a worker holds full Bun
     * privileges and may already. It is that **silo** reads this path and returns
     * the contents over the API, so `..` would make the management API read
     * whatever a manifest names.
     */
    test("a panel entry containing ..", () => {
      expect(() =>
        ManifestReader.validate(
          "x",
          manifest({ contributes: { runtime: true, ui: { entry: "../../etc/hosts.html" } } })
        )
      ).toThrow(/must not contain ".."/);
    });

    test("a panel entry that is absolute, a URL, or not HTML", () => {
      const cases: [string, RegExp][] = [
        ["/etc/panel.html", /must be relative/],
        ["https://evil.example/panel.html", /must be a path, not a URL/],
        ["./panel.ts", /must name a \.html file/],
        ["..\\panel.html", /must use "\/" as its separator/],
      ];
      for (const [entry, message] of cases) {
        expect(() =>
          ManifestReader.validate("x", manifest({ contributes: { runtime: true, ui: { entry } } }))
        ).toThrow(message);
      }
    });

    /** A package contributing only a panel is legal — unusual, since a panel with
     *  no routes can only show what it shipped with, but refusing it would be the
     *  reader answering a question about taste. */
    test("a panel on its own is a contribution", () => {
      const read = ManifestReader.validate(
        "x",
        manifest({ contributes: { ui: { entry: "./panel.html" } } })
      );
      expect(read.contributes.ui).toEqual({ entry: "./panel.html" });
      expect(read.contributes.routes).toEqual([]);
    });
  });

  describe("serving a panel", () => {
    /**
     * **Never as a document.** The API and the admin SPA share an origin, and the
     * admin keeps an API key per configured server in that origin's
     * `localStorage` — so plugin HTML rendered here would be a credential
     * exfiltration primitive for every silo the operator has ever connected to,
     * which is strictly more than any plugin can be granted.
     */
    test("answers JSON, with the headers that keep a browser from rendering it", async () => {
      await load([scanner()]);

      const response = await app.request("/api/plugins/scanner/ui", { headers: auth() });

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("application/json");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
      expect(response.headers.get("cache-control")).toBe("no-store");

      const body = await json(response);
      expect(body.title).toBe("Scanner");
      expect(body.entry).toBe("./panel.html");
      expect(body.html).toContain("scanner panel");
    });

    test("needs plugins:read", async () => {
      await load([scanner()]);
      const { secret } = await service.keys.create("narrow", ["collections:*/*/*:entries:read"], {
        actor: { kind: "system" },
      });

      const response = await app.request("/api/plugins/scanner/ui", {
        headers: { Authorization: `Bearer ${secret}` },
      });
      expect(response.status).toBe(403);
    });

    test("a plugin that contributes no panel is a 404 saying how one is declared", async () => {
      await load([scanner(), pluginConfig("greeter", { claims: ["http:route"] })]);

      const response = await app.request("/api/plugins/greeter/ui", { headers: auth() });
      expect(response.status).toBe(404);
      expect((await json(response)).error.message).toContain("silo.contributes.ui");
    });
  });

  describe("the route surface joins the digest", () => {
    /**
     * `http:route` is one claim however many routes there are, so before D41 the
     * claim list could not see the route surface change. A package could add
     * `"auth": "public"` to a route in a patch release and publish everything it
     * was granted at an unauthenticated URL, against an approval nobody was asked
     * to reconsider.
     */
    test("auth and the body cap change it; the method and path alone do not suffice", () => {
      const base: PluginRoute = {
        method: "POST",
        path: "/upload",
        auth: "key",
        body: PluginRouteBodies.Default,
      };
      const digest = (route: PluginRoute) =>
        PluginGrantUtils.digest([], [], [], PluginGrantUtils.routeLines([route]));

      expect(digest(base)).not.toBe(digest({ ...base, auth: "public" }));
      expect(digest(base)).not.toBe(
        digest({ ...base, body: { kind: "bytes", max_bytes: 64 * 1024 * 1024 } })
      );
      expect(digest(base)).toBe(digest({ ...base }));
    });

    /** A record written before D41 has no `routes`, and the honest reading of one
     *  is the empty list: whatever routes the package had, they were not part of
     *  what was approved. */
    test("a legacy record reads as having approved no route surface", () => {
      expect(PluginGrantUtils.routesOf({ routes: undefined } as any)).toEqual([]);
      // And a plugin with no routes keeps the digest it already had, so upgrading
      // does not re-prompt for a decision nobody changed.
      expect(PluginGrantUtils.digest(["a"], ["a"], ["entry.afterWrite"], [])).toBe(
        PluginGrantUtils.digest(["a"], ["a"], ["entry.afterWrite"])
      );
    });

    test("the stored record carries what was read from the manifest", async () => {
      await load([scanner()]);

      const record = await service.plugins.find("scanner");
      expect(record?.routes).toContain("POST /bytes auth=key body=bytes:4194304");
      expect(record?.routes).toContain("POST /text auth=key body=text:1048576");
    });
  });

  /**
   * D33 says a plugin never hears about a write it caused, and said it
   * unconditionally — but the chain was copied off the **waiter**, and a waiter
   * exists only while the dispatch that made it is open. So work that outlived its
   * dispatch arrived with an empty chain, and a plugin that both did background
   * work and declared a hook was delivered its own writes: `A -> A`, the exact
   * shape D33 made unrepresentable everywhere else.
   */
  describe("a write that outlives its dispatch (D33's hole)", () => {
    test("still carries the plugin's own name, so it is not delivered its own write", async () => {
      await load([scanner()]);

      const started = await app.request("/api/ext/scanner/later", {
        method: "POST",
        headers: { ...auth(), "content-type": "application/json" },
        body: JSON.stringify({ collection: "notes" }),
      });
      expect(started.status).toBe(202);

      // The handler awaits its own background write before answering, so this is
      // ordered rather than raced.
      const seen = await app.request("/api/ext/scanner/seen", { headers: auth() });
      expect((await json(seen)).seen).toEqual([]);

      // The write did happen — the plugin simply was not told about it.
      const page = await service.entries.list(scope, "notes", {});
      expect(page.total).toBe(1);
    });

    /** The control: an ordinary request's write *is* delivered, so the test above
     *  is about the chain rather than about hooks being off. */
    test("an ordinary write is still delivered", async () => {
      await load([scanner()]);

      await app.request("/api/projects/default/environments/prod/collections/notes", {
        method: "POST",
        headers: { ...auth(), "content-type": "application/json" },
        body: JSON.stringify({ title: "from a request" }),
      });

      const seen = await app.request("/api/ext/scanner/seen", { headers: auth() });
      expect((await json(seen)).seen).toEqual(["notes:api:0"]);
    });
  });
});
