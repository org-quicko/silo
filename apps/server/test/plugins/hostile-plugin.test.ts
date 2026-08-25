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

const Fixtures = path.join(import.meta.dir, "fixtures");

/**
 * The test that justifies the `Worker` (D31/§13.4).
 *
 * A hook that never returns is not a hypothetical — it is a `while` loop
 * someone got wrong, or an await on something that never settles. Nothing
 * preempts JavaScript, so in-process that plugin owns the thread forever and
 * the whole instance is gone. This pins that it does not.
 *
 * It also pins the *shape* of the recovery: the runaway plugin is torn down and
 * stays down, rather than being restarted into the same wall a moment later.
 */
describe("a runaway plugin cannot take the server with it", () => {
  let tempDir: string;
  let store: SqliteStore;
  let service: SiloService;
  let registry: PluginRegistry | null = null;
  const scope = Scope.Default;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-hostile-test-"));
    await fs.cp(path.join(Fixtures, "hostile"), path.join(tempDir, "plugins", "hostile"), {
      recursive: true,
    });
    store = await SqliteStore.open(path.join(tempDir, "test.db"));
    service = new SiloService(store, { mediaDir: path.join(tempDir, "media") });
    await service.scopes.initDefaults();
    await service.collections.putSchema(scope, "posts", {
      type: "object",
      properties: { title: { type: "string" } },
    });

    const config = ConfigLoader.defaultConfig();
    config.storage.path = tempDir;
    config.plugins = [
      {
        name: "hostile",
        // Delivery is granted, never inferred (D34) — and this plugin has to be
        // *reachable* for the timeout to be the thing under test.
        claims: ["hooks:*/*/*:entry.beforeValidate"],
        // Short, so the test does not spend five seconds proving a timer works.
        timeout_ms: 700,
        on_error: "skip",
        config: {},
      },
    ];
    registry = await PluginRegistry.load(config, service, Logger.silent());
    service.useHooks(registry.hooks());
  }, 30000);

  afterEach(async () => {
    await registry?.stop();
    registry = null;
    await store.close();
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  test("the spinning hook is timed out and the host keeps working", async () => {
    const started = Date.now();

    // `on_error: "skip"` — so the hook is faulted, logged, and the write
    // proceeds without it. The point is that this returns at all.
    const first = await service.entries.create(scope, "posts", { title: "one" });
    const elapsed = Date.now() - started;

    expect(first.id).toBeTruthy();
    // Bounded by the budget, not by the plugin: a spin that owned the thread
    // would never have got here.
    expect(elapsed).toBeGreaterThanOrEqual(500);
    expect(elapsed).toBeLessThan(15000);

    // The host is still answering — this is the whole claim.
    const second = await service.entries.create(scope, "posts", { title: "two" });
    expect(second.id).toBeTruthy();
    expect((await service.entries.list(scope, "posts", {})).total).toBe(2);
  }, 30000);

  test("a faulted plugin stays down instead of being restarted into the same wall", async () => {
    await service.entries.create(scope, "posts", { title: "one" });

    // The second write must not pay the timeout again: the worker was torn
    // down on the first one, so every later dispatch fails immediately. A
    // restart would re-enter the spin and cost the budget per write forever.
    const started = Date.now();
    await service.entries.create(scope, "posts", { title: "two" });
    expect(Date.now() - started).toBeLessThan(500);
  }, 30000);
});
