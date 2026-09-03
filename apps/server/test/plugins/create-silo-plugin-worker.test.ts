import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { SqliteStore } from "../../src/adapters/storage/sqlite/sqlite-store";
import { SiloService } from "../../src/core/services/silo-service";
import { Scope } from "../../src/core/domain/scope";
import { Logger } from "../../src/logging/logger";
import { ConfigLoader } from "../../src/config/config-loader";
import { PluginRegistry } from "../../src/plugins";
import type { PluginConfig } from "../../src/config/plugin-config";
import { Scaffold } from "../../../../packages/create-silo-plugin/src/scaffold";
import { SiloRange } from "../../../../packages/create-silo-plugin/src/silo-range";
import type { ScaffoldOptions } from "../../../../packages/create-silo-plugin/src/scaffold-options";
import { TomlSnippet } from "../../../../packages/create-silo-plugin/src/render/toml-snippet";

/**
 * A scaffolded plugin, loaded the way `serve` loads one: through
 * `PluginRegistry`, into a real `Worker`, writing through a real `SiloService`.
 *
 * This is the assertion the tool exists to earn — that someone who runs
 * `npm create silo-plugin`, copies the directory under their data dir and
 * pastes the printed `[[plugins]]` block gets a working plugin, with nothing
 * to repair first. Everything cheaper (does the manifest parse, does the module
 * export what it declares) lives in `create-silo-plugin.test.ts`; this is the
 * one that crosses the structured-clone boundary every payload really crosses,
 * and an inline load would pass a plugin whose worker cannot start.
 *
 * Separated into its own file because the worker host is the part carrying a
 * runtime dependency the rest of the scaffolder does not. `WorkerHost` boots
 * from a `data:` URL of roughly 4 KB, and Bun 1.3.13 on macOS rejected one that
 * size outright (§13.10) — every plugin test in this directory failed, for a
 * reason that had nothing to do with any of them. The pin is 1.4.0, where they
 * pass; the split is kept so that if the floor ever moves again, it takes down
 * the end-to-end test and not the assertions about generated code.
 */
describe("a scaffolded plugin, loaded the way serve loads one", () => {
  let tempDir: string;
  let store: SqliteStore;
  let service: SiloService;
  let registry: PluginRegistry | null = null;
  const scope = Scope.Default;

  const options = (over: Partial<ScaffoldOptions> = {}): ScaffoldOptions => ({
    name: "silo-plugin-slugs",
    directory: path.join(tempDir, "plugins", over.name ?? "silo-plugin-slugs"),
    kind: "extension",
    siloRange: SiloRange.default(),
    hooks: ["entry.beforeValidate"],
    routes: [],
    runtime: false,
    panel: false,
    claims: [],
    withConfig: true,
    force: false,
    ...over,
  });

  const pluginConfig = (name: string, over: Partial<PluginConfig> = {}): PluginConfig => ({
    name,
    claims: [],
    timeout_ms: 5000,
    on_error: "fail",
    config: {},
    ...over,
  });

  /** Scaffold into `<data dir>/plugins/` and load it — which is literally the
   *  install procedure the generated README prints. */
  const scaffoldAndLoad = async (opts: ScaffoldOptions, pluginBlock: PluginConfig) => {
    await Scaffold.create(opts);
    const config = ConfigLoader.defaultConfig();
    config.storage.path = tempDir;
    // The claims the *printed* block grants, not a list this test made up: what
    // is being asserted is that pasting that block yields a working plugin,
    // which since D34 includes the `hooks:` claim each declared hook needs.
    config.plugins = [{ ...pluginBlock, claims: TomlSnippet.requestedClaims(opts) }];
    registry = await PluginRegistry.load(config, service, Logger.silent());
    service.useHooks(registry.hooks());
    return registry;
  };

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "create-silo-plugin-worker-"));
    store = await SqliteStore.open(path.join(tempDir, "test.db"));
    service = new SiloService(store, { mediaDir: path.join(tempDir, "media") });
    await service.scopes.initDefaults();
    await service.collections.putSchema(scope, "posts", {
      type: "object",
      properties: { title: { type: "string" }, slug: { type: "string" } },
      required: ["title"],
    });
  });

  afterEach(async () => {
    await registry?.stop();
    registry = null;
    await store.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test("the default scaffold loads and rewrites an entry", async () => {
    await scaffoldAndLoad(
      options(),
      pluginConfig("silo-plugin-slugs", { config: { collection: "posts" } })
    );

    const entry = await service.entries.create(scope, "posts", { title: "Hello Plugin World" });

    // Stored, not merely returned: the mutation went through validation and
    // into the write, which is what `entry.beforeValidate` running *before*
    // the schema means.
    expect(entry.data.slug).toBe("hello-plugin-world");
    expect((await service.entries.get(scope, "posts", entry.id)).data.slug).toBe("hello-plugin-world");
  }, 30000);

  test("a scaffold declaring all five hooks starts", async () => {
    // Nothing is skipped with a warning: a declared hook the module does not
    // export refuses the start, so a clean load *is* the assertion.
    await scaffoldAndLoad(
      options({
        name: "silo-plugin-everything",
        hooks: [
          "entry.beforeValidate",
          "entry.beforeWrite",
          "entry.afterWrite",
          "entry.beforeDelete",
          "entry.afterDelete",
        ],
      }),
      pluginConfig("silo-plugin-everything", { config: { collection: "posts" } })
    );

    expect([...registry!.list()[0]!.hooks].sort()).toEqual([
      "entry.afterDelete",
      "entry.afterWrite",
      "entry.beforeDelete",
      "entry.beforeValidate",
      "entry.beforeWrite",
    ]);
  }, 30000);

  test("a scaffold with no config schema loads with no [plugins.config] at all", async () => {
    await scaffoldAndLoad(
      options({ name: "silo-plugin-bare", withConfig: false }),
      pluginConfig("silo-plugin-bare")
    );

    const entry = await service.entries.create(scope, "posts", { title: "No Config Here" });
    expect(entry.data.slug).toBe("no-config-here");
  }, 30000);
});
