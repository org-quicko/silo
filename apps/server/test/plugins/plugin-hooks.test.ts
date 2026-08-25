import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { SqliteStore } from "../../src/adapters/storage/sqlite/sqlite-store";
import { SiloService } from "../../src/core/services/silo-service";
import { Scope } from "../../src/core/domain/scope";
import { Logger } from "../../src/logging/logger";
import { ValidationError } from "@silo/shared/validation-error";
import { PluginRegistry } from "../../src/plugins";
import type { PluginConfig } from "../../src/config/plugin-config";
import { ConfigLoader } from "../../src/config/config-loader";

const Fixtures = path.join(import.meta.dir, "fixtures");

function pluginConfig(name: string, over: Partial<PluginConfig> = {}): PluginConfig {
  return {
    name,
    claims: [],
    timeout_ms: 5000,
    on_error: "fail",
    config: {},
    ...over,
  };
}


/**
 * Await a rejection and hand back the error.
 *
 * Not `expect(p).rejects` — measured: that idiom starves the `Worker` message
 * callback, so a dispatch that actually answers in ~20 ms instead sits until
 * its timeout and the assertion sees a `PluginTimeoutError` rather than what
 * the plugin threw. Every rejection here crosses a worker boundary, so they all
 * go through this.
 */
async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (caught) {
    return caught as Error;
  }
  throw new Error("expected a rejection, got none");
}

/**
 * The plugin hook path end to end (D31/§13.5), through the **worker** host —
 * the one that ships. An inline load would pass plugins whose worker cannot
 * start, and would not exercise the structured-clone boundary that every
 * payload actually crosses.
 */
describe("plugin hooks", () => {
  let tempDir: string;
  let store: SqliteStore;
  let service: SiloService;
  let registry: PluginRegistry | null = null;
  const scope = Scope.Default;

  /**
   * Copy the named fixtures into `<tempDir>/plugins/` and load them.
   *
   * Copied rather than pointed at in place, because that is literally how a
   * plugin is installed in 1.0 — a directory under the data dir (§13.3) — so
   * the test exercises the real resolution rule instead of a path trick.
   */
  const load = async (plugins: PluginConfig[]) => {
    for (const p of plugins) {
      await fs.cp(path.join(Fixtures, p.name), path.join(tempDir, "plugins", p.name), {
        recursive: true,
      });
    }
    const config = ConfigLoader.defaultConfig();
    config.storage.path = tempDir;
    config.plugins = plugins;
    registry = await PluginRegistry.load(config, service, Logger.silent());
    service.useHooks(registry.hooks());
    return registry;
  };

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-plugin-test-"));
    store = await SqliteStore.open(path.join(tempDir, "test.db"));
    service = new SiloService(store, { mediaDir: path.join(tempDir, "media") });
    await service.scopes.initDefaults();
    await service.collections.putSchema(scope, "posts", {
      type: "object",
      properties: { title: { type: "string" }, slug: { type: "string" }, blocked: { type: "boolean" } },
      required: ["title"],
    });
    await service.collections.putSchema(scope, "mirrors", {
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

  test("beforeValidate rewrites data, and the schema judges what was rewritten", async () => {
    await load([pluginConfig("slugger", { config: { from: "title" } })]);

    const entry = await service.entries.create(scope, "posts", { title: "Hello Plugin World" });
    expect(entry.data.slug).toBe("hello-plugin-world");

    // Stored, not merely returned — the write carried the mutation.
    const stored = await service.entries.get(scope, "posts", entry.id);
    expect(stored.data.slug).toBe("hello-plugin-world");
  }, 30000);

  test("a ValidationError from a hook is a rejection, not a fault", async () => {
    await load([pluginConfig("guard")]);

    // Rejection: surfaces as the same error a schema failure would, so the HTTP
    // layer maps it to 400 rather than 500 (§13.9).
    let raised: unknown;
    try {
      await service.entries.create(scope, "posts", { title: "nope", blocked: true });
    } catch (caught) {
      raised = caught;
    }
    expect(ValidationError.is(raised)).toBe(true);
    expect((raised as ValidationError).message).toContain("blocked by the guard plugin");
    // The details survived the worker boundary, rebuilt by name (PluginError).
    expect((raised as ValidationError).details[0]?.path).toBe("/blocked");

    // ...and nothing was written.
    const listed = await service.entries.list(scope, "posts", {});
    expect(listed.total).toBe(0);

    // An unblocked write still goes through.
    const ok = await service.entries.create(scope, "posts", { title: "fine" });
    expect(ok.id).toBeTruthy();
  }, 30000);

  test("an ordinary throw is a plugin fault, governed by on_error", async () => {
    await load([pluginConfig("crasher", { on_error: "fail" })]);
    const failed = await rejection(service.entries.create(scope, "posts", { title: "x" }));
    expect(failed.message).toMatch(/crasher.*kaboom/s);
    await registry!.stop();

    // The same plugin, skipped instead: the write lands.
    registry = null;
    await load([pluginConfig("crasher", { on_error: "skip" })]);
    const entry = await service.entries.create(scope, "posts", { title: "x" });
    expect(entry.id).toBeTruthy();
  }, 30000);

  /**
   * Three writes, not one — the count is the whole point (D33).
   *
   * A hook writing through `ctx` used to re-enter its own runtime and block on
   * the per-plugin mutex its own caller held, so the dispatch sat until
   * `timeout_ms` and `WorkerHost` destroyed the worker; there is no restart, so
   * the plugin was dead for the rest of the process. With one write the entry
   * still landed (the store write precedes the hook), so the assertion passed
   * and the deadlock was invisible — it showed only as a test that took exactly
   * `timeout_ms` to pass. The second write is what exposes it.
   */
  test("a hook may write through ctx repeatedly without stalling or dying", async () => {
    await load([
      pluginConfig("mirror", {
        claims: ["collections:*/*/*:entries:create"],
        config: { into: "mirrors" },
        timeout_ms: 2000,
      }),
    ]);

    const started = Bun.nanoseconds();
    const entries = [];
    for (const title of ["one", "two", "three"]) {
      entries.push(await service.entries.create(scope, "posts", { title }));
    }

    // afterWrite is best-effort and dispatched after the write returns, so a
    // mirror may not have landed yet. Poll rather than sleep a fixed amount.
    let mirrors = await service.entries.list(scope, "mirrors", {});
    for (let i = 0; i < 100 && mirrors.total < 3; i++) {
      await Bun.sleep(20);
      mirrors = await service.entries.list(scope, "mirrors", {});
    }

    // Every write mirrored: the plugin survived its own first ctx call.
    expect(mirrors.total).toBe(3);
    expect(mirrors.items.map((m) => m.data.title).sort()).toEqual(
      entries.map((e) => `copy of ${e.id}`).sort()
    );

    // And promptly. A deadlock resolved by the dispatch timeout would put this
    // at or past `timeout_ms`, which is the shape the bug actually had.
    const elapsedMs = (Bun.nanoseconds() - started) / 1_000_000;
    expect(elapsedMs).toBeLessThan(2000);

    // The mirror writes are themselves mirrored to nothing: the plugin is in
    // its own causal chain by then, so the host does not dispatch back into it.
    expect(mirrors.items.every((m) => !m.data.title.startsWith("copy of copy"))).toBe(true);
  }, 30000);

  /**
   * The property the causal chain buys over the `origin` check it replaces:
   * neither plugin here ever sees its own name on an event, because each is
   * told about the *other's* write. A self-check cannot break this loop; only
   * the chain can (D33).
   */
  test("two plugins cannot ping-pong writes at each other", async () => {
    await service.collections.putSchema(scope, "pings", {
      type: "object",
      properties: { note: { type: "string" } },
    });
    await service.collections.putSchema(scope, "pongs", {
      type: "object",
      properties: { note: { type: "string" } },
    });

    await load([
      pluginConfig("pinger", { claims: ["collections:*/*/*:entries:create"], timeout_ms: 2000 }),
      pluginConfig("ponger", { claims: ["collections:*/*/*:entries:create"], timeout_ms: 2000 }),
    ]);

    await service.entries.create(scope, "pings", { note: "start" });
    await Bun.sleep(600);

    // One trip around and then stopped: the seed ping, pinger's pong, ponger's
    // ping. That last ping reaches neither plugin — both are already in its
    // chain — so nothing further is written.
    expect((await service.entries.list(scope, "pings", {})).total).toBe(2);
    expect((await service.entries.list(scope, "pongs", {})).total).toBe(1);
  }, 30000);

  test("a plugin cannot use a claim the operator did not grant", async () => {
    // The manifest requests entries:delete; the config grants nothing. Refused
    // at load, naming the claim — not at request time, from inside a hook, as a
    // 403 on somebody else's write (§13.3).
    const failed = await rejection(load([pluginConfig("greedy")]));
    expect(failed.message).toMatch(/greedy.*entries:delete.*does not grant/s);
  }, 30000);

  test("a plugin whose range excludes this binary is refused", async () => {
    const failed = await rejection(load([pluginConfig("future")]));
    expect(failed.message).toMatch(/needs silo \^99/);
  }, 30000);

  test("a plugin that declares a hook it does not export is refused", async () => {
    const failed = await rejection(load([pluginConfig("liar")]));
    expect(failed.message).toMatch(/declares entry\.beforeWrite but exports no such function/);
  }, 30000);
});
