import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { ValidationError } from "@silo/shared/validation-error";
import { ConfigFileAccess } from "../../src/settings/config-file-access";

/**
 * Whether a settings save can land, and what is said when it cannot (D50).
 *
 * The failure this file exists for is a container: `silo.toml` defaulting into
 * an image directory the server's own user cannot write, where the page offered
 * a form and the save came back `500 internal error` with the reason only in
 * the log. So the two properties are that the probe answers about the *path*
 * rather than about having been given one, and that a filesystem refusal
 * arrives as something the operator can act on.
 */
describe("ConfigFileAccess", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-config-access-"));
  });

  afterEach(async () => {
    await fs.chmod(dir, 0o700).catch(() => {});
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  test("a process with no config file, or no way to re-read one, cannot save", async () => {
    for (const report of [
      await ConfigFileAccess.report(undefined, true),
      await ConfigFileAccess.report(path.join(dir, "silo.toml"), false),
    ]) {
      expect(report.writable).toBe(false);
      expect(report.read_only_reason).toMatch(/without a config file/);
    }
  });

  test("an existing file that can be written reports no reason at all", async () => {
    const configPath = path.join(dir, "silo.toml");
    await fs.writeFile(configPath, "listen = \":8090\"\n", "utf8");

    expect(await ConfigFileAccess.report(configPath, true)).toEqual({ writable: true });
  });

  test("a file that is not there yet is writable when it could be created", async () => {
    // Two levels down, because `ConfigScaffold` creates the directories: asking
    // only about the immediate parent would refuse a save that would work.
    const report = await ConfigFileAccess.report(path.join(dir, "etc", "silo", "silo.toml"), true);

    expect(report.writable).toBe(true);
  });

  // Windows does not honour a mode that only takes write away, so there is
  // nothing to make unwritable here. The property still holds on the platform
  // the containers run on, which is the one the failure came from.
  test.skipIf(process.platform === "win32")(
    "a directory the server cannot write to is read-only, and says which path",
    async () => {
      const configPath = path.join(dir, "silo.toml");
      await fs.chmod(dir, 0o500);

      const report = await ConfigFileAccess.report(configPath, true);
      expect(report.writable).toBe(false);
      expect(report.read_only_reason).toContain(configPath);
      expect(report.read_only_reason).toMatch(/SILO_CONFIG/);
    }
  );

  test("a filesystem refusal is reported as one, and the file is put back", async () => {
    const configPath = path.join(dir, "silo.toml");
    let restored = false;

    const failing = async () => {
      throw Object.assign(new Error("EACCES: permission denied, open 'silo.toml'"), {
        code: "EACCES",
      });
    };

    const raised = await ConfigFileAccess.writing(
      configPath,
      async () => {
        restored = true;
      },
      failing
    ).catch((caught) => caught);

    expect(ValidationError.is(raised)).toBe(true);
    expect(raised.message).toContain(configPath);
    expect(raised.message).toMatch(/permission denied/);
    expect(raised.message).toMatch(/SILO_CONFIG/);
    expect(restored).toBe(true);
  });

  test("anything that is not a refusal keeps its own error, and its 500", async () => {
    let restored = false;

    const raised = await ConfigFileAccess.writing(
      path.join(dir, "silo.toml"),
      async () => {
        restored = true;
      },
      async () => {
        throw new TypeError("undefined is not a function");
      }
    ).catch((caught) => caught);

    expect(ValidationError.is(raised)).toBe(false);
    expect(raised).toBeInstanceOf(TypeError);
    expect(restored).toBe(true);
  });
});
