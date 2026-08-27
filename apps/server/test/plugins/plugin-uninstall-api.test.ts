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

/**
 * `DELETE /api/plugins/:name` (D43).
 *
 * The install tests assert that a refused install leaves nothing behind; these
 * assert the mirror property, which is the one an operator is actually betting
 * on: after an uninstall the instance can still **start**. So every case here
 * checks all four places a plugin lives — the file, the record, the running set
 * and the disk — rather than the status code, because the failure mode being
 * guarded against is a `[[plugins]]` block left naming a package that is gone.
 */
describe("plugin uninstall API (DELETE /api/plugins/:name)", () => {
  let tempDir: string;
  let configPath: string;
  let store: SqliteStore;
  let service: SiloService;
  let registry: PluginRegistry | null = null;
  let supervisor: PluginSupervisor;
  let app: Hono;
  let rootKey: string;

  const auth = () => ({ Authorization: `Bearer ${rootKey}` });

  const onDisk = (name: string) =>
    fs
      .stat(path.join(tempDir, "plugins", name))
      .then(() => true)
      .catch(() => false);

  const toml = () => fs.readFile(configPath, "utf8");
  const listed = async (name: string) => (await toml()).includes(`name       = "${name}"`);

  /** Install through the API, so what is being uninstalled is exactly what the
   *  other half of this feature produces — block, record, worker and all. */
  const install = async (fixture: string, claims?: string[]) => {
    const response = await app.request("/api/plugins/install", {
      method: "POST",
      headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify({
        spec: path.join(Fixtures, fixture),
        ...(claims === undefined ? {} : { claims }),
      }),
    });
    expect(response.status).toBe(201);
    return (await response.json()) as any;
  };

  const uninstall = (name: string, rev?: number) =>
    app.request(`/api/plugins/${encodeURIComponent(name)}`, {
      method: "DELETE",
      headers: { ...auth(), ...(rev === undefined ? {} : { "If-Match": `"${rev}"` }) },
    });

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-uninstall-api-"));
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
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  test("takes the plugin out of the file, the record, the running set and the disk", async () => {
    const installed = await install("greeter");
    expect(installed.runtime.state).toBe("running");
    expect((await app.request("/api/ext/greeter/hello?who=x")).status).toBe(200);

    const response = await uninstall("greeter", installed.rev);
    expect(response.status).toBe(200);

    const outcome: any = await response.json();
    expect(outcome.name).toBe("greeter");
    expect(outcome.unlisted).toBe(true);
    expect(outcome.forgotten).toBe(true);
    expect(outcome.removed).toBe(true);
    expect(outcome.warnings).toEqual([]);

    expect(await listed("greeter")).toBe(false);
    expect(await onDisk("greeter")).toBe(false);
    expect(await service.plugins.find("greeter")).toBeNull();
    expect((await app.request("/api/plugins/greeter", { headers: auth() })).status).toBe(404);
    // The route is gone from the live table, not merely unauthorized.
    expect((await app.request("/api/ext/greeter/hello?who=x")).status).toBe(404);
  });

  /**
   * The property the whole ordering exists for. A block left naming a deleted
   * package does not fail that plugin — `PluginLoader.loadExtensions` has no
   * per-plugin rescue, so it fails the process.
   */
  test("leaves a config the next start can actually load", async () => {
    const greeter = await install("greeter");
    const pinger = await install("pinger");

    expect((await uninstall("greeter", greeter.rev)).status).toBe(200);

    const reloaded = await ConfigLoader.loadConfig(configPath, true);
    expect(reloaded.plugins.map((plugin) => plugin.name)).toEqual(["pinger"]);
    // The survivor is untouched: same block, same record, still running.
    const survivor: any = await (
      await app.request("/api/plugins/pinger", { headers: auth() })
    ).json();
    expect(survivor.rev).toBe(pinger.rev);
    expect(survivor.runtime.state).toBe("running");
  });

  /** The managed key is a credential nothing else names once the record is
   *  gone, so it has to go with it rather than be left resolving. */
  test("discards the plugin's managed key", async () => {
    const installed = await install("greeter");
    expect(installed.key_id).toBeTruthy();
    expect(await service.keys.find(installed.key_id)).toBeTruthy();

    expect((await uninstall("greeter", installed.rev)).status).toBe(200);
    // `discard` deletes the row rather than flagging it, so the lookup is the
    // one that no longer resolves — which is the property that fails closed.
    expect(service.keys.find(installed.key_id)).rejects.toThrow();
  });

  /**
   * What the plugin could do at the moment it was taken away is only knowable
   * from the trail afterwards, so the trail has to outlive the record.
   */
  test("records the uninstall, and what was withdrawn, after the record is gone", async () => {
    const installed = await install("greeter");
    expect((await uninstall("greeter", installed.rev)).status).toBe(200);

    const page = await service.audit.list({ subject: "greeter", limit: 20 });
    const event = page.items.find((each) => each.action === "plugin.uninstall");
    expect(event).toBeTruthy();
    expect(event!.detail.withdrawn).toEqual(installed.granted);
  });

  test("refuses a stale If-Match and changes nothing", async () => {
    const installed = await install("greeter");

    const response = await uninstall("greeter", installed.rev + 7);
    expect(response.status).toBe(409);

    expect(await listed("greeter")).toBe(true);
    expect(await onDisk("greeter")).toBe(true);
    expect(await service.plugins.find("greeter")).not.toBeNull();
    expect((await app.request("/api/ext/greeter/hello?who=x")).status).toBe(200);
  });

  test("refuses without plugins:enable, leaving the plugin installed", async () => {
    await install("greeter");
    const readOnly = await service.keys.create("readonly-key", ["plugins:read"], {
      actor: { kind: "system" },
    });

    const response = await app.request("/api/plugins/greeter", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${readOnly.secret}` },
    });

    expect(response.status).toBe(403);
    expect(await listed("greeter")).toBe(true);
    expect(await onDisk("greeter")).toBe(true);
  });

  test("answers 404 for a name this instance has never heard of", async () => {
    const response = await uninstall("nothing-of-the-sort");
    expect(response.status).toBe(404);
  });

  /**
   * The one that makes uninstall a remedy rather than a tidy-up: what comes
   * back is a new record, not the old one revived.
   *
   * `reconcile` writes a record for every listed plugin at every start, so a
   * record that had merely been *emptied* would be indistinguishable from this
   * one call by call — and would quietly restore the old grant the moment the
   * package was re-listed. The revision and the key id are what tell them
   * apart: both restart, and the credential the old grant was carried on is
   * gone rather than reused.
   */
  test("a re-installed package comes back on a new record and a new key", async () => {
    const first = await install("greeter");
    expect(first.state).toBe("granted");
    expect((await uninstall("greeter", first.rev)).status).toBe(200);

    const again = await install("greeter");
    // The same revision the first install ended on, not one past it: a record
    // that had survived would have kept counting.
    expect(again.rev).toBe(first.rev);
    expect(again.key_id).toBeTruthy();
    expect(again.key_id).not.toBe(first.key_id);
    expect(service.keys.find(first.key_id)).rejects.toThrow();
  });

  /** A `[plugins.config]` sub-table belongs to the block above it. Removing the
   *  block without it would re-parent the settings onto the *next* plugin. */
  test("removes an entry's config sub-table with it, and leaves its neighbours alone", async () => {
    await install("greeter");
    await install("pinger");

    const before = await toml();
    await fs.writeFile(
      configPath,
      before.replace(
        `on_error   = "fail"\n\n# ${"Added by POST /api/plugins/install"}`,
        `on_error   = "fail"\n\n  [plugins.config]\n  greeting = "hi"\n\n# Added by POST /api/plugins/install`
      ),
      "utf8"
    );
    expect(await toml()).toContain("[plugins.config]");

    const greeter: any = await (
      await app.request("/api/plugins/greeter", { headers: auth() })
    ).json();
    expect((await uninstall("greeter", greeter.rev)).status).toBe(200);

    const after = await toml();
    expect(after).not.toContain("[plugins.config]");
    expect(after).not.toContain('greeting = "hi"');

    const reloaded = await ConfigLoader.loadConfig(configPath, true);
    expect(reloaded.plugins.map((plugin) => plugin.name)).toEqual(["pinger"]);
    expect(reloaded.plugins[0]!.config).toEqual({});
  });

  /** An operator's own comments are not silo's to delete; the note silo wrote
   *  above a block it added is. */
  test("takes its own note with the block and leaves the operator's comments", async () => {
    await fs.writeFile(
      configPath,
      `${await toml()}\n# my own note about plugins, which I would like to keep\n`,
      "utf8"
    );
    const greeter = await install("greeter");

    expect((await uninstall("greeter", greeter.rev)).status).toBe(200);

    const after = await toml();
    expect(after).toContain("# my own note about plugins, which I would like to keep");
    expect(after).not.toContain("Added by POST /api/plugins/install");
    expect(after).not.toContain("greeter");
  });
});
