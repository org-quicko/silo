import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { ConfigLoader } from "../../src/config/config-loader";
import { TrashDefaults } from "../../src/config/trash-defaults";

/**
 * `[trash]` and its two variables (D113). The trash is a safety net, so the
 * one thing that must never happen is a config that switches it off by
 * accident: an older file that does not mention it, or a variable silo does
 * not understand.
 */
describe("ConfigLoader [trash] settings", () => {
  let tempDir: string;
  const names = ["SILO_TRASH_ENABLED", "SILO_TRASH_RETENTION_DAYS"] as const;
  const saved: Partial<Record<(typeof names)[number], string | undefined>> = {};

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-trash-config-test-"));
    for (const name of names) {
      saved[name] = process.env[name];
      delete process.env[name];
    }
  });

  afterEach(async () => {
    for (const name of names) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const writeConfig = async (toml: string): Promise<string> => {
    const file = path.join(tempDir, "silo.toml");
    await fs.writeFile(file, toml);
    return file;
  };

  test("a file from before the trash existed keeps it on", async () => {
    // What `silo init` wrote before 1.6.0: no [trash] table at all.
    const file = await writeConfig(`listen = ":8090"\n\n[storage]\ndriver = "sqlite"\npath = "./silo_data"\n`);
    expect((await ConfigLoader.loadConfig(file)).trash).toEqual({
      enabled: true,
      retention_days: TrashDefaults.RetentionDays,
    });
  });

  test("SILO_TRASH_ENABLED reads true and false in any case, and outranks the file", async () => {
    const file = await writeConfig(`[trash]\nenabled = true\n`);
    for (const [raw, enabled] of [["false", false], ["False", false], [" FALSE ", false], ["TRUE", true]] as const) {
      process.env.SILO_TRASH_ENABLED = raw;
      expect((await ConfigLoader.loadConfig(file)).trash.enabled).toBe(enabled);
    }
  });

  test("any other SILO_TRASH_ENABLED value is refused, never read as on or off", async () => {
    for (const raw of ["0", "1", "no", "off", "flase"]) {
      process.env.SILO_TRASH_ENABLED = raw;
      await expect(ConfigLoader.loadConfig(path.join(tempDir, "absent.toml"))).rejects.toThrow(
        `SILO_TRASH_ENABLED must be "true" or "false", not "${raw}"`
      );
    }
  });
});
