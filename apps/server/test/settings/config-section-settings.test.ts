import { afterEach, describe, expect, test } from "bun:test";
import { ValidationError } from "@silo/shared/validation-error";
import { ConfigLoader } from "../../src/config/config-loader";
import { ConfigSections } from "../../src/config/config-sections";
import { ConfigSectionSettings } from "../../src/settings";

const log = ConfigSections.find("log")!;
const auth = ConfigSections.find("auth")!;
const storage = ConfigSections.find("storage")!;
const search = ConfigSections.find("search")!;

/**
 * The rules the settings API applies to any table (D47).
 *
 * These are the checks that stop a save from looking like it worked. A typo'd
 * key that writes nothing, a number where an enum belongs, an auth switch
 * turned off through the API protecting it — each would be a 200 with a
 * different instance behind it.
 */
describe("ConfigSectionSettings", () => {
  const cleared: string[] = [];
  afterEach(() => {
    for (const name of cleared) delete process.env[name];
    cleared.length = 0;
  });
  const withEnv = (name: string, value: string) => {
    process.env[name] = value;
    cleared.push(name);
  };

  describe("parse", () => {
    test("an unknown key is refused rather than dropped", () => {
      // Dropping it would be a clean 200 for a setting that never took, which
      // is the one outcome an operator cannot tell from success.
      expect(() => ConfigSectionSettings.parse(log, { max_size: 5 })).toThrow(
        /no setting "max_size"/
      );
    });

    test("each type is checked", () => {
      expect(() => ConfigSectionSettings.parse(log, { requests: "yes" })).toThrow(ValidationError);
      expect(() => ConfigSectionSettings.parse(log, { max_files: "3" })).toThrow(/must be a number/);
      expect(() => ConfigSectionSettings.parse(log, { level: "chatty" })).toThrow(/must be one of/);
      expect(() => ConfigSectionSettings.parse(log, { file: 7 })).toThrow(/must be a string/);
    });

    test("a number below its floor is refused", () => {
      expect(() => ConfigSectionSettings.parse(search, { scan_limit: 0 })).toThrow(/at least 1/);
      expect(ConfigSectionSettings.parse(log, { max_size_mb: 0 })).toEqual({ max_size_mb: 0 });
    });

    test("a read-only field says so rather than being silently ignored", () => {
      expect(() => ConfigSectionSettings.parse(storage, { path: "/somewhere/else" })).toThrow(
        /reported here, not changed here/
      );
    });

    test("a valid body comes back with its strings trimmed", () => {
      expect(ConfigSectionSettings.parse(log, { level: "debug", file: "  /var/log/silo.log  " })).toEqual({
        level: "debug",
        file: "/var/log/silo.log",
      });
    });
  });

  describe("assertTightening", () => {
    test("auth can be switched back on, never off", () => {
      expect(() => ConfigSectionSettings.assertTightening(auth, { disabled: false })).not.toThrow();
      expect(() => ConfigSectionSettings.assertTightening(auth, { disabled: true })).toThrow(
        /cannot be turned on through the API/
      );
    });

    test("a section with no rule is unaffected", () => {
      expect(() => ConfigSectionSettings.assertTightening(log, { requests: true })).not.toThrow();
    });
  });

  describe("merge", () => {
    test("the file is the base, so an untouched field keeps what the file holds", () => {
      expect(ConfigSectionSettings.merge({ level: "warn", file: "/a.log" }, { level: "debug" })).toEqual(
        { level: "debug", file: "/a.log" }
      );
    });
  });

  describe("overrides", () => {
    test("a field the file decides has nothing to report", () => {
      expect(ConfigSectionSettings.overrides(log, { level: "warn" }, { level: "warn" })).toEqual([]);
    });

    test("an environment variable is named whenever it is set, even when it agrees", () => {
      // It still wins, so the next edit to that field will do nothing.
      withEnv("SILO_LOG_LEVEL", "warn");
      expect(ConfigSectionSettings.overrides(log, { level: "warn" }, { level: "warn" })).toEqual([
        { field: "level", env: "SILO_LOG_LEVEL" },
      ]);
    });

    test("a value that differs with no variable set is reported unnamed", () => {
      expect(ConfigSectionSettings.overrides(log, { level: "warn" }, { level: "debug" })).toEqual([
        { field: "level" },
      ]);
    });

    test("a field the file never names is not an override", () => {
      expect(ConfigSectionSettings.overrides(log, {}, { level: "info" })).toEqual([]);
      expect(ConfigSectionSettings.overrides(log, null, { level: "info" })).toEqual([]);
    });
  });

  describe("restartPending", () => {
    test("only restart-marked fields that actually differ are owed one", () => {
      expect(
        ConfigSectionSettings.restartPending(log, { level: "debug", file: "/new.log" }, { level: "info", file: "/old.log" })
      ).toEqual(["file"]);
    });

    test("a field saved back to what is running owes nothing", () => {
      expect(ConfigSectionSettings.restartPending(log, { file: "/same.log" }, { file: "/same.log" })).toEqual([]);
    });
  });
});

/**
 * The catalogue and the loader are two halves of one statement, and the failure
 * when they drift is silent both ways.
 */
describe("ConfigSections", () => {
  test("every table names a real config key", () => {
    const config = ConfigLoader.defaultConfig() as unknown as Record<string, unknown>;
    for (const section of ConfigSections.All) {
      expect(config[section.table]).toBeDefined();
    }
  });

  test("every field is a key the loader defaults, so a save cannot write a dead setting", () => {
    const config = ConfigLoader.defaultConfig() as unknown as Record<string, Record<string, unknown>>;
    for (const section of ConfigSections.All) {
      for (const field of section.fields) {
        // `[log] file` is the documented exception: it has no default, because a
        // literal there would be indistinguishable from a path someone chose.
        if (section.table === "log" && field.key === "file") continue;
        expect(config[section.table]?.[field.key]).toBeDefined();
      }
    }
  });

  test("every declared environment variable is one the loader reads", () => {
    const loader = ConfigLoader.toString();
    for (const section of ConfigSections.All) {
      for (const field of section.fields) {
        if (field.env) expect(loader).toContain(field.env);
      }
    }
  });

  test("only [log] has fields that apply without a restart", () => {
    // `ConfigSupervisor.adopt` copies non-restart fields into what it reports as
    // in force, and the logger is the only applier it has. A new one anywhere
    // else would be reported as applied while nothing had changed.
    for (const section of ConfigSections.All) {
      for (const field of section.fields) {
        if (section.table === "log") continue;
        expect(field.restart).toBe(true);
      }
    }
  });

  test("nothing writable is also read-only, and [storage] is neither writable nor written", () => {
    for (const section of ConfigSections.All) {
      for (const field of section.fields) {
        if (field.readOnly) expect(section.writable).toBe(false);
      }
    }
    expect(storage.writable).toBe(false);
  });
});
