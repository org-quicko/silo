import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { SqliteStore } from "../../src/adapters/storage/sqlite/sqlite-store";
import { SiloService } from "../../src/core/services/silo-service";
import { Scope } from "../../src/core/domain/scope";
import { Logger } from "../../src/logging/logger";
import { SiloServer } from "../../src/http/server";
import { PluginRegistry } from "../../src/plugins";
import type { PluginConfig } from "../../src/config/plugin-config";
import { ConfigLoader } from "../../src/config/config-loader";

const Fixtures = path.join(import.meta.dir, "fixtures");

function pluginConfig(name: string, over: Partial<PluginConfig> = {}): PluginConfig {
  return { name, claims: [], timeout_ms: 5000, on_error: "fail", config: {}, ...over };
}

/**
 * `collection.afterDelete`, and the hole it closes (D36, D37's F6).
 *
 * The finding was measured and left open for five phases: `CollectionEraser`
 * calls `store.delete` directly, so a forced collection, environment or project
 * delete removed every entry underneath it and dispatched **nothing**. An
 * auditing or mirroring plugin watched entries appear and never saw them go.
 *
 * So the shape of every test here is the same: erase something, and ask a plugin
 * what it was told. `archivist` writes one row per erasure into `mirrors`,
 * because a hook that fires and cannot be observed proves only half of it.
 */
describe("bulk erasure is visible to plugins (D37 F6)", () => {
  let tempDir: string;
  let store: SqliteStore;
  let service: SiloService;
  let registry: PluginRegistry | null = null;
  const scope = Scope.Default;

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
    registry.attach(
      new SiloServer(service, {
        version: "test",
        authDisabled: false,
        logger: Logger.silent(),
      }).build()
    );
    await registry.activate();
    return registry;
  };

  /** What the archivist recorded, in the order it recorded it. */
  const seen = async (where: Scope = scope): Promise<string[]> => {
    const page = await service.entries.list(where, "mirrors", {});
    return page.items.map((entry: any) => entry.data.title);
  };

  const archivist = (claims: string[]) => pluginConfig("archivist", { claims });

  const collection = async (where: Scope, name: string): Promise<void> => {
    await service.collections.putSchema(where, name, {
      type: "object",
      properties: { title: { type: "string" } },
    });
  };

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-erasure-test-"));
    store = await SqliteStore.open(path.join(tempDir, "test.db"));
    service = new SiloService(store, { mediaDir: path.join(tempDir, "media") });
    await service.scopes.initDefaults();
    await collection(scope, "posts");
    await collection(scope, "mirrors");
  });

  afterEach(async () => {
    await registry?.stop();
    registry = null;
    await store.close();
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  /**
   * The measurement D37 recorded, now the other way round: a create dispatched
   * and the force-delete that removed it did not.
   */
  test("a forced collection delete is delivered, and carries what it erased", async () => {
    await load([
      archivist([
        "hooks:*/*/*:collection.afterDelete",
        "collections:*/*/*:entries:create",
      ]),
    ]);

    await service.entries.create(scope, "posts", { title: "one" });
    await service.entries.create(scope, "posts", { title: "two" });
    await service.collections.delete(scope, "posts", true);

    expect(await seen()).toEqual(["erased posts (2, collection)"]);
  }, 30000);

  /** Deleting an empty collection is still the collection going away, and a
   *  mirror that only heard about non-empty ones would keep a table forever. */
  test("an empty collection still reports, with nothing erased", async () => {
    await load([
      archivist([
        "hooks:*/*/*:collection.afterDelete",
        "collections:*/*/*:entries:create",
      ]),
    ]);

    await service.collections.delete(scope, "posts", false);
    expect(await seen()).toEqual(["erased posts (0, collection)"]);
  }, 30000);

  /**
   * One event per collection, not one per entry — which is the whole argument
   * for a collection-level hook. A 100k-row delete is one event here.
   */
  test("an environment delete reports every collection under it, once each", async () => {
    const other = Scope.of("default", "staging");
    await service.scopes.createEnvironment("default", "staging");
    await collection(other, "posts");
    await collection(other, "notes");
    await collection(other, "mirrors");
    await service.entries.create(other, "posts", { title: "a" });
    await service.entries.create(other, "notes", { title: "b" });
    await service.entries.create(other, "notes", { title: "c" });

    await load([
      archivist([
        "hooks:*/*/*:collection.afterDelete",
        "collections:*/*/*:entries:create",
      ]),
    ]);

    await service.scopes.deleteEnvironment("default", "staging", true);

    // Read from the *default* environment: the archivist writes there rather
    // than into `event.scope`, because the scope it is being told about has just
    // been erased along with everything in it. That is not the fixture being
    // careful — it is what the event means.
    const recorded = await seen();
    expect(recorded).toContain("erased posts (1, environment)");
    expect(recorded).toContain("erased notes (2, environment)");
    expect(recorded.filter((line) => line.startsWith("erased"))).toHaveLength(3);
  }, 30000);

  /** `cause` is the difference between "one collection went" and "the scope
   *  above it went", and only the second is a reason to drop everything. */
  test("a project delete says so, rather than looking like three collection deletes", async () => {
    await service.scopes.createProject("archive");
    await service.scopes.createEnvironment("archive", "prod");
    const doomed = Scope.of("archive", "prod");
    await collection(doomed, "posts");
    await service.entries.create(doomed, "posts", { title: "a" });

    await load([
      archivist([
        "hooks:*/*/*:collection.afterDelete",
        "collections:*/*/*:entries:create",
      ]),
    ]);

    await service.scopes.deleteProject("archive", true);
    expect(await seen()).toEqual(["erased posts (1, project)"]);
  }, 30000);

  /**
   * Delivery is a claim, and the new hook is not exempt from it.
   *
   * The claim grammar needed no change to say this — `hooks:<project>/<env>/<collection>`
   * already names a collection — which is what made a collection-level hook one
   * new *name* rather than a new mechanism.
   */
  test("a plugin granted delivery for one collection is not told about another", async () => {
    await load([
      archivist([
        "hooks:default/prod/notes:collection.afterDelete",
        "collections:*/*/*:entries:create",
      ]),
    ]);

    await collection(scope, "notes");
    await service.entries.create(scope, "posts", { title: "unseen" });
    await service.collections.delete(scope, "posts", true);
    expect(await seen()).toEqual([]);

    await service.collections.delete(scope, "notes", false);
    expect(await seen()).toEqual(["erased notes (0, collection)"]);
  }, 30000);

  /**
   * It is terminal, and terminal is asked before the error's class.
   *
   * The same rule the post-commit hooks got in phase 4: the collection is
   * already gone by the time this fires, so a refusal has nothing left to refuse
   * and would answer 403 on a delete that succeeded. Here the plugin is granted
   * delivery and *not* the claim its `ctx` write needs, which is the ordinary
   * outcome of narrowing a grant.
   */
  test("a refusal from it does not reach the caller", async () => {
    await load([archivist(["hooks:*/*/*:collection.afterDelete"])]);

    await service.entries.create(scope, "posts", { title: "one" });

    // Resolves: had the refusal propagated, this would reject with a 403 naming
    // a claim the caller neither needed nor lacked, about a delete that had
    // already happened.
    await service.collections.delete(scope, "posts", true);

    const remaining = await service.collections.list(scope);
    expect(remaining.map((each: any) => each.name)).not.toContain("posts");

    // And the hook really did run and really was refused — otherwise this test
    // would pass just as happily against a hook that was never dispatched.
    expect(await seen()).toEqual([]);
  }, 30000);
});
