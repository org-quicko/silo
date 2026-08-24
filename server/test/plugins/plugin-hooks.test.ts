import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { SqliteStore } from "../../adapters/storage/sqlite/sqlite-store";
import { Service } from "../../core/service/service";
import { Scope } from "../../core/domain/scope";
import { Logger } from "../../logging/logger";
import { ValidationError } from "@silo/shared/validation-error";
import { PluginRegistry } from "../../plugins";
import type { PluginConfig } from "../../config/plugin-config";
import { ConfigLoader } from "../../config/config-loader";

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
  } catch (err) {
    return err as Error;
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
  let svc: Service;
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
    const cfg = ConfigLoader.defaultConfig();
    cfg.storage.path = tempDir;
    cfg.plugins = plugins;
    registry = await PluginRegistry.load(cfg, svc, Logger.silent());
    svc.useHooks(registry.hooks());
    return registry;
  };

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-plugin-test-"));
    store = await SqliteStore.open(path.join(tempDir, "test.db"));
    svc = new Service(store, { mediaDir: path.join(tempDir, "media") });
    await svc.initDefaults();
    await svc.putSchema(scope, "posts", {
      type: "object",
      properties: { title: { type: "string" }, slug: { type: "string" }, blocked: { type: "boolean" } },
      required: ["title"],
    });
    await svc.putSchema(scope, "mirrors", {
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

    const entry = await svc.createEntry(scope, "posts", { title: "Hello Plugin World" });
    expect(entry.data.slug).toBe("hello-plugin-world");

    // Stored, not merely returned — the write carried the mutation.
    const stored = await svc.getEntry(scope, "posts", entry.id);
    expect(stored.data.slug).toBe("hello-plugin-world");
  }, 30000);

  test("a ValidationError from a hook is a rejection, not a fault", async () => {
    await load([pluginConfig("guard")]);

    // Rejection: surfaces as the same error a schema failure would, so the HTTP
    // layer maps it to 400 rather than 500 (§13.9).
    let raised: unknown;
    try {
      await svc.createEntry(scope, "posts", { title: "nope", blocked: true });
    } catch (err) {
      raised = err;
    }
    expect(ValidationError.is(raised)).toBe(true);
    expect((raised as ValidationError).message).toContain("blocked by the guard plugin");
    // The details survived the worker boundary, rebuilt by name (PluginError).
    expect((raised as ValidationError).details[0]?.path).toBe("/blocked");

    // ...and nothing was written.
    const listed = await svc.listEntries(scope, "posts", {});
    expect(listed.total).toBe(0);

    // An unblocked write still goes through.
    const ok = await svc.createEntry(scope, "posts", { title: "fine" });
    expect(ok.id).toBeTruthy();
  }, 30000);

  test("an ordinary throw is a plugin fault, governed by on_error", async () => {
    await load([pluginConfig("crasher", { on_error: "fail" })]);
    const failed = await rejection(svc.createEntry(scope, "posts", { title: "x" }));
    expect(failed.message).toMatch(/crasher.*kaboom/s);
    await registry!.stop();

    // The same plugin, skipped instead: the write lands.
    registry = null;
    await load([pluginConfig("crasher", { on_error: "skip" })]);
    const entry = await svc.createEntry(scope, "posts", { title: "x" });
    expect(entry.id).toBeTruthy();
  }, 30000);

  test("ctx writes are claim-checked and carry a plugin origin", async () => {
    await load([
      pluginConfig("mirror", {
        claims: ["collections:*/*/*:entries:create"],
        config: { into: "mirrors" },
      }),
    ]);

    const entry = await svc.createEntry(scope, "posts", { title: "source" });

    // afterWrite is best-effort and dispatched after the write returns, so the
    // mirror may not have landed yet. Poll rather than sleep a fixed amount.
    let mirrors = { total: 0 } as { total: number };
    for (let i = 0; i < 100 && mirrors.total === 0; i++) {
      mirrors = await svc.listEntries(scope, "mirrors", {});
      if (mirrors.total === 0) await Bun.sleep(20);
    }
    expect(mirrors.total).toBe(1);

    const [mirror] = (await svc.listEntries(scope, "mirrors", {})).items;
    expect(mirror!.data.title).toBe(`copy of ${entry.id}`);
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
