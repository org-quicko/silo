import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { TOML } from "bun";
import { Hono } from "hono";
import { Claims } from "@silo/shared/claims";
import { SqliteStore } from "../../src/adapters/storage/sqlite/sqlite-store";
import { SiloService } from "../../src/core/services/silo-service";
import { ConfigLoader } from "../../src/config/config-loader";
import { ConfigScaffold } from "../../src/config/config-scaffold";
import { SiloServer } from "../../src/http/server";
import { Logger } from "../../src/logging/logger";
import { ConfigSupervisor } from "../../src/settings";

/**
 * `GET /api/settings` and `PUT /api/settings/{table}` (D47).
 *
 * The end-to-end properties: the routes are behind `settings:configure` and
 * nothing wider, a save rewrites one table and leaves the document alone, what
 * needs a restart says so instead of being reported as in force, and `[storage]`
 * and `[auth]` cannot be used to point the instance elsewhere or switch its own
 * authentication off.
 */
describe("settings API (D47)", () => {
  let tempDir: string;
  let store: SqliteStore;
  let service: SiloService;
  let app: Hono;
  let rootKey: string;
  let configPath: string;

  const build = async (options: { withFile: boolean }) => {
    const config = options.withFile
      ? await ConfigLoader.loadConfig(configPath, true)
      : ConfigLoader.defaultConfig();

    return new SiloServer(service, {
      version: "test",
      authDisabled: false,
      logger: Logger.silent(),
      settings: new ConfigSupervisor({
        service,
        config,
        logger: Logger.silent(),
        ...(options.withFile
          ? { configPath, reload: () => ConfigLoader.loadConfig(configPath, true) }
          : {}),
      }),
    }).build();
  };

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-settings-api-"));
    configPath = path.join(tempDir, "silo.toml");
    await ConfigScaffold.create(configPath);
    store = await SqliteStore.open(path.join(tempDir, "silo.db"));
    service = new SiloService(store, { mediaDir: path.join(tempDir, "media") });
    rootKey = await service.keys.bootstrap();
    app = await build({ withFile: true });
  });

  afterEach(async () => {
    await store.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const mint = async (claims: string[]) => (await service.keys.create("probe", claims)).secret;
  const auth = (key: string) => ({ Authorization: `Bearer ${key}` });
  const json = (key: string) => ({ ...auth(key), "Content-Type": "application/json" });
  const put = (key: string, table: string, body: unknown) =>
    app.request(`/api/settings/${table}`, {
      method: "PUT",
      headers: json(key),
      body: JSON.stringify(body),
    });
  const section = (view: any, table: string) =>
    view.sections.find((each: any) => each.table === table);

  test("reading needs settings:configure, which no other claim implies", async () => {
    const wide = await mint([Claims.MediaConfigure, Claims.AuditRead, Claims.KeysRead]);
    const refused = await app.request("/api/settings", { headers: auth(wide) });
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as any).error.message).toContain("settings:configure");

    const allowed = await app.request("/api/settings", {
      headers: auth(await mint([Claims.SettingsConfigure])),
    });
    expect(allowed.status).toBe(200);
  });

  test("writing needs it too", async () => {
    expect((await put(await mint([Claims.MediaConfigure]), "log", { level: "debug" })).status).toBe(403);
  });

  test("the read reports every section with its spec", async () => {
    const view = (await (await app.request("/api/settings", { headers: auth(rootKey) })).json()) as any;
    expect(view.sections.map((each: any) => each.table)).toEqual([
      "log",
      "search",
      "schema",
      "auth",
      "storage",
    ]);
    expect(section(view, "log").fields.some((f: any) => f.key === "level")).toBe(true);
    expect(view.writable).toBe(true);
    expect(view.restart_pending).toBe(false);
  });

  test("a live field takes effect now and is reported as in force", async () => {
    const saved = (await (await put(rootKey, "log", { level: "debug" })).json()) as any;
    expect(section(saved, "log").in_force.level).toBe("debug");
    expect(section(saved, "log").restart_pending).toEqual([]);
  });

  test("a restart field is written, and reported as owed rather than as in force", async () => {
    // The honest half of this design: the file now says one thing and the
    // process is still doing another, and the page has to say which is which.
    const saved = (await (await put(rootKey, "log", { file: "/var/log/silo.log" })).json()) as any;
    expect(section(saved, "log").file.file).toBe("/var/log/silo.log");
    expect(section(saved, "log").in_force.file).toBeUndefined();
    expect(section(saved, "log").restart_pending).toEqual(["file"]);
    expect(saved.restart_pending).toBe(true);
  });

  test("a save rewrites one table and leaves the rest of the document alone", async () => {
    const before = await fs.readFile(configPath, "utf8");
    await put(rootKey, "search", { tokenizer: "trigram" });

    const after = await fs.readFile(configPath, "utf8");
    const parsed = TOML.parse(after) as any;
    expect(parsed.search.tokenizer).toBe("trigram");
    expect(parsed.storage.driver).toBe((TOML.parse(before) as any).storage.driver);
    expect(after).toContain("[blob_storage]");
    // A comment outside the edited table survives; `ConfigScaffold` writes many.
    expect(after).toContain("# dev only");
  });

  test("an unknown section is a 400 that lists the real ones", async () => {
    const response = await put(rootKey, "nonsense", { x: 1 });
    expect(response.status).toBe(400);
    expect(((await response.json()) as any).error.message).toContain("log, search, schema, auth, storage");
  });

  test("[storage] cannot be pointed somewhere else", async () => {
    // Changing it does not configure this instance, it names a different one.
    const response = await put(rootKey, "storage", { path: "/somewhere/else" });
    expect(response.status).toBe(400);
    expect(section(await (await app.request("/api/settings", { headers: auth(rootKey) })).json(), "storage").writable).toBe(false);
  });

  test("auth can be switched back on through the API but never off", async () => {
    expect((await put(rootKey, "auth", { disabled: true })).status).toBe(400);
    expect((await put(rootKey, "auth", { disabled: false })).status).toBe(200);
  });

  test("a process with no config file says so rather than guessing at a path", async () => {
    app = await build({ withFile: false });
    const response = await put(rootKey, "log", { level: "debug" });
    expect(response.status).toBe(400);
    expect(((await response.json()) as any).error.message).toContain("not started from a config file");
  });

  test("a change is recorded on the trail", async () => {
    await put(rootKey, "log", { level: "warn" });
    const trail = (await (await app.request("/api/audit?limit=1", { headers: auth(rootKey) })).json()) as any;
    expect(trail.items[0].action).toBe("settings.configure");
    expect(trail.items[0].subject).toBe("log");
  });
});
