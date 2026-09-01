import { describe, test, expect, afterEach } from "bun:test";
import { CliOptions } from "../../src/cli/cli-options";

/**
 * Which config file a run reads (D50).
 *
 * `SILO_CONFIG` exists for the layer a container has: an image someone else
 * built has no argv to edit, and since D45 the file is written as well as read,
 * so an instance that cannot be told where its config lives has a Settings page
 * that cannot save.
 */
describe("CliOptions.configPath", () => {
  const saved = process.env.SILO_CONFIG;

  afterEach(() => {
    if (saved === undefined) delete process.env.SILO_CONFIG;
    else process.env.SILO_CONFIG = saved;
  });

  test("`silo.toml` beside the process when nothing names one", () => {
    delete process.env.SILO_CONFIG;

    expect(CliOptions.configPath(CliOptions.parse(["serve"]).values)).toBe("silo.toml");
  });

  test("the environment names one, and the flag outranks it", () => {
    process.env.SILO_CONFIG = "/data/silo.toml";

    expect(CliOptions.configPath(CliOptions.parse(["serve"]).values)).toBe("/data/silo.toml");
    expect(
      CliOptions.configPath(CliOptions.parse(["serve", "--config", "./local.toml"]).values)
    ).toBe("./local.toml");
  });

  test("an empty variable is not a path", () => {
    process.env.SILO_CONFIG = "   ";

    expect(CliOptions.configPath(CliOptions.parse(["serve"]).values)).toBe("silo.toml");
  });

  // Naming the file this way is deliberately not the same as `--config`: a
  // fresh volume has no file yet, and the first save is what creates it.
  test("only the flag makes a missing file an error", () => {
    process.env.SILO_CONFIG = "/data/silo.toml";

    expect(CliOptions.configWasExplicit(["serve"])).toBe(false);
    expect(CliOptions.configWasExplicit(["serve", "--config", "/data/silo.toml"])).toBe(true);
  });
});
