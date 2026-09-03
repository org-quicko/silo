import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { SqliteStore } from "../../src/adapters/storage/sqlite/sqlite-store";
import { SiloService } from "../../src/core/services/silo-service";
import { Scope } from "../../src/core/domain/scope";
import { Logger } from "../../src/logging/logger";
import { SiloServer } from "../../src/http/server";
import { PluginRegistry, PluginSupervisor } from "../../src/plugins";
import { ConfigLoader } from "../../src/config/config-loader";
import type { Hono } from "hono";

const Fixtures = path.join(import.meta.dir, "fixtures");
const scope = Scope.Default;

describe("plugin install API (POST /api/plugins/install)", () => {
  let tempDir: string;
  let configPath: string;
  let store: SqliteStore;
  let service: SiloService;
  let registry: PluginRegistry | null = null;
  let supervisor: PluginSupervisor;
  let app: Hono;
  let rootKey: string;

  const auth = () => ({ Authorization: `Bearer ${rootKey}` });

  /** Whether the package landed in `<data dir>/plugins/`. The half of "nothing
   *  was installed" that `silo.toml` cannot show. */
  const installed = (name: string) =>
    fs
      .stat(path.join(tempDir, "plugins", name))
      .then(() => true)
      .catch(() => false);

  const listed = async (name: string) =>
    (await fs.readFile(configPath, "utf8")).includes(`name       = "${name}"`);

  /** A package built outside the plugins directory, so installing it is a real
   *  `directory` install rather than a rename of something already in place. */
  const fixture = async (
    name: string,
    silo: Record<string, unknown>,
    entry = `import { defineSiloPlugin } from "silo:api";\nexport default defineSiloPlugin({ "GET /x"() { return { json: { ok: true } }; } });\n`
  ): Promise<string> => {
    const dir = path.join(tempDir, "sources", name);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({
        name,
        version: "1.0.0",
        type: "module",
        main: "index.ts",
        silo: { silo: "*", ...silo },
      }),
      "utf8"
    );
    await fs.writeFile(path.join(dir, "index.ts"), entry, "utf8");
    return dir;
  };

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-install-api-"));
    await fs.mkdir(path.join(tempDir, "plugins"), { recursive: true });
    configPath = path.join(tempDir, "silo.toml");
    await fs.writeFile(
      configPath,
      `[storage]\ndriver = "sqlite"\npath = ${JSON.stringify(tempDir)}\n`,
      "utf8"
    );

    store = await SqliteStore.open(path.join(tempDir, "test.db"));
    service = new SiloService(store, { mediaDir: path.join(tempDir, "media") });
    rootKey = await service.keys.bootstrap();
    await service.scopes.initDefaults();
    await service.collections.putSchema(scope, "notes", {
      type: "object",
      properties: { title: { type: "string" } },
    });

    const config = ConfigLoader.defaultConfig();
    config.storage.path = tempDir;
    config.plugins = [];

    const reload = async () => {
      const reloaded = await ConfigLoader.loadConfig(configPath, true);
      reloaded.storage.path = tempDir;
      return reloaded;
    };

    registry = PluginRegistry.empty(Logger.silent());
    supervisor = new PluginSupervisor({
      registry,
      service,
      logger: Logger.silent(),
      config,
      reload,
      configPath,
    });
    app = new SiloServer(service, {
      version: "test",
      authDisabled: false,
      logger: Logger.silent(),
      plugins: supervisor,
    }).build();
    registry.attach(app);
  });

  afterEach(async () => {
    await registry?.stop();
    registry = null;
    await store.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test("installs a plugin from a local directory spec and starts it immediately", async () => {
    const greeterSource = path.join(Fixtures, "greeter");
    const response = await app.request("/api/plugins/install", {
      method: "POST",
      headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify({
        spec: greeterSource,
        claims: [
          "http:route",
          "collections:*/*/*:entries:read",
          "collections:*/*/*:entries:create",
        ],
      }),
    });

    expect(response.status).toBe(201);
    const body: any = await response.json();
    expect(body.name).toBe("greeter");
    expect(body.state).toBe("granted");
    expect(body.runtime.state).toBe("running");

    // Check that silo.toml has the new block appended
    const tomlContent = await fs.readFile(configPath, "utf8");
    expect(tomlContent).toContain('name       = "greeter"');

    // Route is now reachable live
    const routeRes = await app.request("/api/ext/greeter/hello?who=installer");
    expect(routeRes.status).toBe(200);
    const routeJson: any = await routeRes.json();
    expect(routeJson.greeting).toBe("hello");
  });

  test("installs a plugin from an uploaded tarball file via multipart/form-data", async () => {
    const { c } = await import("tar");
    const staging = path.join(tempDir, "staging");
    await fs.mkdir(path.join(staging, "package"), { recursive: true });
    await fs.writeFile(
      path.join(staging, "package", "package.json"),
      JSON.stringify({
        name: "silo-plugin-tarball-test",
        version: "1.0.0",
        type: "module",
        main: "index.ts",
        silo: {
          silo: "*",
          contributes: {
            routes: [{ method: "GET", path: "/ping", auth: "public" }],
          },
          permissions: {
            required: [],
          },
        },
      }),
      "utf8"
    );
    await fs.writeFile(
      path.join(staging, "package", "index.ts"),
      `import { defineSiloPlugin } from "silo:api";\nexport default defineSiloPlugin({ "GET /ping"() { return { json: { pong: true } }; } });\n`,
      "utf8"
    );

    const tarballPath = path.join(tempDir, "plugin.tgz");
    await c({ file: tarballPath, cwd: staging, gzip: true }, ["package"]);

    const tarballBytes = await fs.readFile(tarballPath);
    const file = new File([tarballBytes], "plugin.tgz", { type: "application/gzip" });

    const formData = new FormData();
    formData.append("file", file);
    formData.append("claims", "http:route");

    const response = await app.request("/api/plugins/install", {
      method: "POST",
      headers: auth(),
      body: formData,
    });

    expect(response.status).toBe(201);
    const body: any = await response.json();
    expect(body.name).toBe("silo-plugin-tarball-test");
    expect(body.runtime.state).toBe("running");

    // Live endpoint is reachable
    const pingRes = await app.request("/api/ext/silo-plugin-tarball-test/ping");
    expect(pingRes.status).toBe(200);
    expect(((await pingRes.json()) as any).pong).toBe(true);
  });

  test("refuses to install without plugins:enable claim", async () => {
    const unprivilegedKey = await service.keys.create(
      "readonly-key",
      ["plugins:read"],
      { actor: { kind: "system" } }
    );

    const response = await app.request("/api/plugins/install", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${unprivilegedKey.secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ spec: path.join(Fixtures, "greeter") }),
    });

    expect(response.status).toBe(403);
  });

  test("refuses install with missing or empty spec", async () => {
    const response = await app.request("/api/plugins/install", {
      method: "POST",
      headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify({ spec: "   " }),
    });

    expect(response.status).toBe(400);
    const body: any = await response.json();
    expect(body.error.message).toContain("spec is required");
  });

  test("refuses install when requested claims do not cover required manifest claims", async () => {
    const response = await app.request("/api/plugins/install", {
      method: "POST",
      headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify({
        spec: path.join(Fixtures, "greeter"),
        claims: ["http:route"], // Missing collections:*/*/*:entries:create which greeter requires
      }),
    });

    expect(response.status).toBe(400);
    const body: any = await response.json();
    expect(body.error.message).toContain("requires");
  });

  /**
   * The default is `PluginGrantResolver.request().required`, which includes the
   * **derived** claims — `http:route`, one per declared hook — and not just the
   * manifest's `permissions.required`. A default that omitted them wrote a block
   * for a plugin `assertServable` then refused to start, leaving `silo.toml`
   * naming a package the next `serve` would refuse the whole instance over.
   */
  test("defaults to everything the package requires, derived claims included", async () => {
    const response = await app.request("/api/plugins/install", {
      method: "POST",
      headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify({ spec: path.join(Fixtures, "greeter") }),
    });

    expect(response.status).toBe(201);
    const body: any = await response.json();
    expect(body.runtime.state).toBe("running");
    expect(body.effective).toContain("http:route");
    expect(body.effective).toContain("collections:*/*/*:entries:create");
    expect((await app.request("/api/ext/greeter/hello?who=x")).status).toBe(200);
  });

  /**
   * Registration in the operator's file, authorization in the record (D34).
   *
   * Effective authority is the file **unioned** with the record, and only the
   * record half passes `assertGrantable` and `canDelegate` — so a block carrying
   * claims would be a grant no check ever sees, on this install and on every
   * start after it. The block therefore carries none.
   */
  test("writes a claimless block and keeps the grant in the record", async () => {
    await app.request("/api/plugins/install", {
      method: "POST",
      headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify({ spec: path.join(Fixtures, "greeter") }),
    });

    const toml = await fs.readFile(configPath, "utf8");
    expect(toml).toContain(`name       = "greeter"`);
    expect(toml).toContain(`claims     = []`);

    const record = await service.plugins.find("greeter");
    expect(record?.state).toBe("granted");
    expect(record?.granted).toContain("http:route");
    expect(record?.key_id).toBeTruthy();
  });

  /** The reason the block is claimless, stated as a test: revoking has to be
   *  able to take *everything* back. A block carrying claims would leave the
   *  plugin holding them after `DELETE .../grant` said it had none. */
  test("revoking after an install leaves the plugin holding nothing", async () => {
    const install = await app.request("/api/plugins/install", {
      method: "POST",
      headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify({ spec: path.join(Fixtures, "greeter") }),
    });
    const rev = (await install.json() as any).rev;

    const revoked = await app.request("/api/plugins/greeter/grant", {
      method: "DELETE",
      headers: { ...auth(), "If-Match": `"${rev}"` },
    });

    expect(revoked.status).toBe(200);
    const body: any = await revoked.json();
    expect(body.effective).toEqual([]);
    expect(body.config_claims).toEqual([]);
    expect((await app.request("/api/ext/greeter/hello?who=x")).status).toBe(403);
  });

  /**
   * The delegation check `PluginGrantService.grant` makes, hoisted to where it
   * can still refuse. Left only there it fired *after* the worker was running
   * and the block was written: the caller read a 403 while the plugin it had
   * just installed served requests on claims that key could not delegate.
   */
  test("refuses claims the calling key cannot delegate, and installs nothing", async () => {
    const weak = await service.keys.create("weak", ["plugins:enable", "plugins:read"], {
      actor: { kind: "system" },
    });

    const response = await app.request("/api/plugins/install", {
      method: "POST",
      headers: { Authorization: `Bearer ${weak.secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        spec: path.join(Fixtures, "greeter"),
        claims: [
          "http:route",
          "collections:*/*/*:entries:read",
          "collections:*/*/*:entries:create",
        ],
      }),
    });

    expect(response.status).toBe(403);
    expect(await installed("greeter")).toBe(false);
    expect(await listed("greeter")).toBe(false);
    expect(supervisor.runtime("greeter")).toBeUndefined();
    expect((await app.request("/api/ext/greeter/hello?who=x")).status).toBe(404);
  });

  /** `PluginForbiddenClaims`, refused on the way in rather than after the worker
   *  holding them is already answering requests. */
  test.each([
    ["asked for outright", ["keys:create", "http:route"]],
    ["reached through the manifest's own default", undefined],
  ])("refuses a forbidden claim %s", async (_label, claims) => {
    const source = await fixture("evil", {
      contributes: { routes: [{ method: "GET", path: "/x", auth: "public" }] },
      permissions: { required: [{ claim: "keys:create", reason: "to escalate" }] },
    });

    const response = await app.request("/api/plugins/install", {
      method: "POST",
      headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify(claims ? { spec: source, claims } : { spec: source }),
    });

    expect(response.status).toBe(400);
    expect((await response.json() as any).error.message).toContain("keys:create");
    expect(await installed("evil")).toBe(false);
    expect(await listed("evil")).toBe(false);
  });

  test("refuses claims the manifest never requested", async () => {
    const response = await app.request("/api/plugins/install", {
      method: "POST",
      headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify({
        spec: path.join(Fixtures, "greeter"),
        claims: ["http:route", "collections:*/*/*:entries:read", "media:read"],
      }),
    });

    expect(response.status).toBe(400);
    expect((await response.json() as any).error.message).toContain("did not request");
    expect(await installed("greeter")).toBe(false);
  });

  /**
   * The block is written **last**, which is the ordering that matters most here.
   * A `[[plugins]]` entry for a package that could not start would make the next
   * `serve` refuse the whole instance — a failed API call turning into an
   * unbootable server.
   */
  test("a package that cannot start leaves silo.toml and the plugins dir clean", async () => {
    const source = await fixture(
      "broken",
      { contributes: { hooks: ["entry.beforeWrite"] }, permissions: { required: [] } },
      // Declares a hook it does not export: fails inside the worker, after every
      // static check the installer makes.
      `import { defineSiloPlugin } from "silo:api";\nexport default defineSiloPlugin({});\n`
    );

    const response = await app.request("/api/plugins/install", {
      method: "POST",
      headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify({ spec: source }),
    });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await listed("broken")).toBe(false);
    expect(await installed("broken")).toBe(false);
    expect(supervisor.runtime("broken")).toBeUndefined();

    // The `pending` record `PluginLoader.prepare` wrote on the way in outlives
    // the refusal, and is left to: it is the same record a plugin awaiting
    // approval has at every boot, `reconcile` is not audited, and it carries no
    // authority — which is the property that matters. A rescan whose plugin
    // fails to start leaves exactly this too.
    const record = await service.plugins.find("broken");
    expect(record?.granted ?? []).toEqual([]);
    expect(record?.key_id).toBeUndefined();
  });

  /** A provider is constructed before storage opens, so there is no worker to
   *  authorize and no record to view (§13.7). Reported, not crashed on. */
  test("lists a provider-only package and says it waits for the next start", async () => {
    const source = await fixture(
      "prov",
      {
        contributes: { providers: [{ port: "blob", driver: "dummy", entry: "provider.ts" }] },
        permissions: { required: [] },
      },
      `export default {};\n`
    );
    await fs.writeFile(
      path.join(source, "provider.ts"),
      `export default { create() { return {}; } };\n`,
      "utf8"
    );

    const response = await app.request("/api/plugins/install", {
      method: "POST",
      headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify({ spec: source }),
    });

    expect(response.status).toBe(201);
    const body: any = await response.json();
    expect(body.name).toBe("prov");
    expect(body.state).toBeNull();
    expect(body.warnings.join(" ")).toContain("next start");
    expect(await listed("prov")).toBe(true);
  });

  /**
   * The install used to report success and evaporate. With no `silo.toml` at the
   * path this process was started with, the block had nowhere to go: the plugin
   * ran, the response said so, and nothing came back at the next start (§13.21).
   *
   * The file is asserted through `ConfigLoader` rather than as text, because the
   * point of creating one unasked is that `serve` can start from it.
   */
  test("creates the config file when there is none, so the plugin comes back", async () => {
    await fs.rm(configPath);

    const response = await app.request("/api/plugins/install", {
      method: "POST",
      headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify({ spec: path.join(Fixtures, "greeter") }),
    });

    expect(response.status).toBe(201);
    const body: any = await response.json();
    expect(body.warnings.join(" ")).toContain("was created");
    expect(body.warnings.join(" ")).not.toContain("next start");
    expect(await listed("greeter")).toBe(true);

    const reloaded = await ConfigLoader.loadConfig(configPath, true);
    expect(reloaded.plugins.map((plugin) => plugin.name)).toEqual(["greeter"]);
    // Defaults and nothing else besides the entry: a file written behind the
    // operator's back must not decide anything the run did not already decide.
    expect({ ...reloaded, plugins: [] }).toEqual({
      ...ConfigLoader.defaultConfig(),
      plugins: [],
    });
  });

  test("refuses an archive larger than the upload limit without reading it", async () => {
    const form = new FormData();
    form.append("file", new File([new Uint8Array(8)], "plugin.tgz"));

    const response = await app.request("/api/plugins/install", {
      method: "POST",
      headers: { ...auth(), "content-length": String(128 * 1024 * 1024) },
      body: form,
    });

    expect(response.status).toBe(400);
    expect((await response.json() as any).error.message).toContain("limit");
  });
});
