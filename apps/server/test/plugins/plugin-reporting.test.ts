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
import { PluginCommand } from "../../src/cli/commands/plugin-command";
import type { Config } from "../../src/config/config";
import type { PluginConfig } from "../../src/config/plugin-config";
import { ConfigLoader } from "../../src/config/config-loader";
import { AuditUtils } from "../../src/core/audit/audit-utils";

const Fixtures = path.join(import.meta.dir, "fixtures");

function pluginConfig(name: string, over: Partial<PluginConfig> = {}): PluginConfig {
  return { name, claims: [], timeout_ms: 5000, on_error: "fail", config: {}, ...over };
}

/**
 * What silo *says* about a plugin — three things a live pass caught it not
 * saying (D36).
 *
 * Every one of them is a report rather than a behaviour, which is exactly why
 * the suite missed all three: the plugin did the right thing in each case and
 * nobody was told. That has been the pattern for six phases now, and it is the
 * argument for the live pass rather than an accident of it.
 */
describe("what silo reports about a plugin (D36)", () => {
  let tempDir: string;
  let store: SqliteStore;
  let service: SiloService;
  let registry: PluginRegistry | null = null;
  const scope = Scope.Default;

  const config = (plugins: PluginConfig[]): Config => {
    const built = ConfigLoader.defaultConfig();
    built.storage.path = tempDir;
    built.plugins = plugins;
    return built;
  };

  const install = async (name: string) =>
    await fs.cp(path.join(Fixtures, name), path.join(tempDir, "plugins", name), {
      recursive: true,
    });

  /** A logger writing to a file, so what it emitted can be read back. Not a stub:
   *  the formatting and the level threshold are part of what is being asserted. */
  const logged = (): { logger: Logger; read: () => Promise<string> } => {
    const file = path.join(tempDir, "silo.log");
    const built = ConfigLoader.defaultConfig();
    return {
      logger: Logger.create({ ...built.log, file }, file),
      read: async () => await fs.readFile(file, "utf8").catch(() => ""),
    };
  };

  const load = async (plugins: PluginConfig[], logger = Logger.silent()) => {
    for (const plugin of plugins) await install(plugin.name);
    registry = await PluginRegistry.load(config(plugins), service, logger);
    service.useHooks(registry.hooks());
    registry.attach(
      new SiloServer(service, { version: "test", authDisabled: false, logger }).build()
    );
    await registry.activate();
    return registry;
  };

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-reporting-test-"));
    store = await SqliteStore.open(path.join(tempDir, "test.db"));
    service = new SiloService(store, { mediaDir: path.join(tempDir, "media") });
    await service.scopes.initDefaults();
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

  /**
   * A plugin's `activate` throws the plugin's **own** error, and unwrapped that
   * refuses the start with a sentence naming neither a plugin nor activation.
   *
   * Measured on a running instance: the entire report was
   * `silo: collection "default/prod/mirrors" not found`. `HookBus.run` has always
   * wrapped a failing hook; activation had no equivalent because until D36 there
   * was nothing to activate.
   */
  test("a failing activate names the plugin and what it was doing", async () => {
    // Granted nothing, so the `ctx` write inside `activate` is refused — which is
    // the ordinary way this happens, not a contrived one.
    let raised: Error | null = null;
    try {
      await load([pluginConfig("ticker")]);
    } catch (caught) {
      raised = caught as Error;
    }

    expect(raised).not.toBeNull();
    expect(raised!.message).toContain('plugin "ticker" failed in activate');
    // And the plugin's own reason survives the wrapping, because that is the half
    // that says what to fix.
    expect(raised!.message).toMatch(/forbidden|not permitted|claim/i);
  }, 30000);

  /**
   * Narrowing a grant below what a package requires is warned about **on the live
   * path**, not only at the next start.
   *
   * `PluginLoader.report` has said this since D36 landed, and phase 4 made
   * narrowing something that happens while the process runs — so reporting it
   * only at boot means the operator who narrowed it is the one person who never
   * sees the consequence.
   */
  test("a live narrowing below what a plugin requires is warned about", async () => {
    const { logger, read } = logged();

    // `archivist` requires `entries:create` and a hook claim; narrowing to the
    // hook claim alone leaves it delivered and unable to act.
    await install("archivist");
    const plugins = [pluginConfig("archivist")];
    registry = await PluginRegistry.load(config(plugins), service, logger);
    service.useHooks(registry.hooks());
    registry.attach(
      new SiloServer(service, { version: "test", authDisabled: false, logger }).build()
    );

    const supervisor = new PluginSupervisor({
      registry,
      service,
      logger,
      config: config(plugins),
    });

    await service.plugins.grant(
      "archivist",
      ["hooks:*/*/*:collection.afterDelete", "collections:*/*/*:entries:create"],
      { actor: AuditUtils.cli() }
    );
    await supervisor.grant("archivist", ["hooks:*/*/*:collection.afterDelete"], {
      actor: AuditUtils.cli(),
    });
    await logger.close();

    const text = await read();
    expect(text).toContain("plugin is now granted less than it says it requires");
    expect(text).toContain("collections:*/*/*:entries:create");
  }, 30000);

  /**
   * `silo plugin list` reported the **record's** raw state.
   *
   * The record only ever describes the *store* half of a grant, so a plugin
   * granted entirely through `silo.toml` sits at `pending` there forever. D40
   * found and fixed exactly this in `/api/plugins`; the CLI said it too, and
   * printed `[pending]` directly above the `claims:` line listing what the plugin
   * was running on.
   */
  test("the CLI reports the resolved state, not the record's half of it", async () => {
    await install("archivist");
    const plugins = [
      pluginConfig("archivist", {
        claims: ["hooks:*/*/*:collection.afterDelete", "collections:*/*/*:entries:create"],
      }),
    ];

    const lines: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
    try {
      await PluginCommand.run(config(plugins), service, ["plugin", "list"]);
    } finally {
      console.log = original;
    }

    const row = lines.find((line) => line.includes("archivist"));
    expect(row).toContain("[granted]");
    expect(row).not.toContain("[pending]");
  }, 30000);
});
