import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { InitCommand } from "../../src/cli/commands/init-command";
import { ConfigLoader } from "../../src/config/config-loader";
import { PluginBlockWriter } from "../../src/config/plugin-block-writer";

/**
 * Writing into a file this did not create (D32/§13.8, D43).
 *
 * Two properties, and they pull in opposite directions. The block has to be
 * *correct* — it is read back by the same loader `serve` uses, so the test
 * asserts through `ConfigLoader` rather than against the text. And the rest of
 * the file has to be *untouched*, because `silo init` writes a config that is
 * mostly comments on purpose and a tool that ate them the first time it ran
 * would not be used a second time.
 *
 * `remove` inherits both and raises the stakes on the second: the entry it
 * deletes is a range of lines, and a range that runs one line too far takes a
 * neighbour with it — a plugin an operator never asked to remove, discovered at
 * the next start rather than here.
 */
describe("PluginBlockWriter", () => {
  let dir: string;
  let configPath: string;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-block-test-"));
    configPath = path.join(dir, "silo.toml");
    // The loader reads env on top of the file; a SILO_* var in the ambient
    // environment would otherwise look like the file said it.
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("SILO_")) {
        savedEnv[key] = process.env[key];
        delete process.env[key];
      }
    }
    await InitCommand.run(configPath, false);
  });

  afterEach(async () => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value !== undefined) process.env[key] = value;
    }
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  const add = async (name: string, claims: string[] = []) => {
    const config = PluginBlockWriter.defaults(name, claims);
    await PluginBlockWriter.append(configPath, PluginBlockWriter.render(config));
    return config;
  };

  test("the appended block loads back as the entry that was written", async () => {
    await add("silo-plugin-slug", ["collections:*/*/*:entries:read"]);

    const config = await ConfigLoader.loadConfig(configPath, true);
    expect(config.plugins).toEqual([
      {
        name: "silo-plugin-slug",
        claims: ["collections:*/*/*:entries:read"],
        timeout_ms: ConfigLoader.DefaultPluginTimeoutMs,
        on_error: "fail",
        config: {},
      },
    ]);
  });

  test("nothing else in the file changes", async () => {
    const before = await fs.readFile(configPath, "utf8");
    await add("silo-plugin-slug");

    const after = await fs.readFile(configPath, "utf8");
    expect(after.startsWith(before)).toBe(true);
    // The commented scaffold `silo init` writes is the documentation for every
    // setting; a re-serialising writer would have deleted all of it.
    expect(after).toContain(`# silo.toml — every key is optional`);
    expect(after).toContain(`# file = "/var/log/silo.log"`);
  });

  test("everything else the file said still loads unchanged", async () => {
    const before = await ConfigLoader.loadConfig(configPath, true);
    await add("silo-plugin-slug");

    const after = await ConfigLoader.loadConfig(configPath, true);
    expect({ ...after, plugins: [] as typeof after.plugins }).toEqual(before);
  });

  test("a second plugin appends after the first, which is dispatch order", async () => {
    await add("silo-plugin-first");
    await add("silo-plugin-second");

    const config = await ConfigLoader.loadConfig(configPath, true);
    expect(config.plugins.map((p) => p.name)).toEqual(["silo-plugin-first", "silo-plugin-second"]);
  });

  test("an already-listed plugin is detected through the parser, not a regex", async () => {
    expect(await PluginBlockWriter.names(configPath, "silo-plugin-slug")).toBe(false);
    await add("silo-plugin-slug");
    expect(await PluginBlockWriter.names(configPath, "silo-plugin-slug")).toBe(true);
    expect(await PluginBlockWriter.names(configPath, "silo-plugin-other")).toBe(false);
  });

  test("a scoped name survives the round trip", async () => {
    await add("@acme/silo-plugin-slug");
    const config = await ConfigLoader.loadConfig(configPath, true);
    expect(config.plugins[0]!.name).toBe("@acme/silo-plugin-slug");
  });

  test("no [plugins.config] table is written when there is nothing to put in it", async () => {
    await add("silo-plugin-slug");
    expect(await fs.readFile(configPath, "utf8")).not.toContain("[plugins.config]");
  });

  test("a config table is written when there is", async () => {
    const pluginBlock = PluginBlockWriter.defaults("silo-plugin-slug", []);
    pluginBlock.config = { field: "title", enabled: true };
    await PluginBlockWriter.append(configPath, PluginBlockWriter.render(pluginBlock));

    const config = await ConfigLoader.loadConfig(configPath, true);
    expect(config.plugins[0]!.config).toEqual({ field: "title", enabled: true });
  });

  test("timeout_ms and on_error come through as written", async () => {
    const pluginBlock = PluginBlockWriter.defaults("silo-plugin-slug", []);
    pluginBlock.timeout_ms = 250;
    pluginBlock.on_error = "skip";
    await PluginBlockWriter.append(configPath, PluginBlockWriter.render(pluginBlock));

    const config = await ConfigLoader.loadConfig(configPath, true);
    expect(config.plugins[0]).toMatchObject({ timeout_ms: 250, on_error: "skip" });
  });

  test("a config file that is not there is reported, not created", async () => {
    const missing = path.join(dir, "nowhere.toml");
    expect(await PluginBlockWriter.exists(missing)).toBe(false);
    expect(await PluginBlockWriter.names(missing, "silo-plugin-slug")).toBe(false);
    await expect(fs.stat(missing)).rejects.toThrow();
  });

  test("appending to a file with no trailing newline does not join two lines", async () => {
    await fs.writeFile(configPath, `listen = ":9000"`, "utf8");
    await add("silo-plugin-slug");

    const config = await ConfigLoader.loadConfig(configPath, true);
    expect(config.listen).toBe(":9000");
    expect(config.plugins[0]!.name).toBe("silo-plugin-slug");
  });

  test("removing the middle entry leaves the ones on either side of it", async () => {
    await add("plugin-a");
    await add("plugin-b");
    await add("plugin-c");

    expect(await PluginBlockWriter.remove(configPath, "plugin-b")).toBe(true);

    const config = await ConfigLoader.loadConfig(configPath, true);
    // Order too: the array's order is hook dispatch order, so a remove that
    // reshuffled it would change which plugin sees a write first.
    expect(config.plugins.map((plugin) => plugin.name)).toEqual(["plugin-a", "plugin-c"]);
  });

  test("everything else the file said still loads after a remove", async () => {
    const before = await ConfigLoader.loadConfig(configPath, true);
    await add("silo-plugin-slug");
    await PluginBlockWriter.remove(configPath, "silo-plugin-slug");

    const after = await ConfigLoader.loadConfig(configPath, true);
    expect(after).toEqual(before);
  });

  test("the comments silo init wrote are still there afterwards", async () => {
    const before = await fs.readFile(configPath, "utf8");
    await add("silo-plugin-slug");
    await PluginBlockWriter.remove(configPath, "silo-plugin-slug");

    const after = await fs.readFile(configPath, "utf8");
    for (const line of before.split("\n").filter((each) => each.trim().startsWith("#"))) {
      expect(after).toContain(line.trim());
    }
  });

  test("removing a name the file does not list is not an error", async () => {
    await add("silo-plugin-slug");
    expect(await PluginBlockWriter.remove(configPath, "someone-else")).toBe(false);

    const config = await ConfigLoader.loadConfig(configPath, true);
    expect(config.plugins.map((plugin) => plugin.name)).toEqual(["silo-plugin-slug"]);
  });

  test("a CRLF file stays a CRLF file", async () => {
    await add("plugin-a");
    await add("plugin-b");
    const text = await fs.readFile(configPath, "utf8");
    await fs.writeFile(configPath, text.replace(/\n/g, "\r\n"), "utf8");

    await PluginBlockWriter.remove(configPath, "plugin-a");

    const after = await fs.readFile(configPath, "utf8");
    const unterminated = after
      .split("\n")
      .filter((line) => line.length > 0 && !line.endsWith("\r"));
    expect(unterminated).toEqual([]);
    const config = await ConfigLoader.loadConfig(configPath, true);
    expect(config.plugins.map((plugin) => plugin.name)).toEqual(["plugin-b"]);
  });

  test("a scoped name is removed by the name it was written under", async () => {
    await add("@acme/silo-plugin-slug");
    expect(await PluginBlockWriter.remove(configPath, "@acme/silo-plugin-slug")).toBe(true);

    const config = await ConfigLoader.loadConfig(configPath, true);
    expect(config.plugins).toEqual([]);
  });

  /** The guard, exercised from the one direction that can reach it: a `name`
   *  key inside a config table is not the entry's name, and reading it as one
   *  would delete a block on the strength of a setting. */
  test("a config setting called name does not decide which entry goes", async () => {
    const first = PluginBlockWriter.defaults("plugin-a", []);
    first.config = { name: "plugin-b" };
    await PluginBlockWriter.append(configPath, PluginBlockWriter.render(first));
    await add("plugin-b");

    await PluginBlockWriter.remove(configPath, "plugin-b");

    const config = await ConfigLoader.loadConfig(configPath, true);
    expect(config.plugins.map((plugin) => plugin.name)).toEqual(["plugin-a"]);
    expect(config.plugins[0]!.config).toEqual({ name: "plugin-b" });
  });
});
