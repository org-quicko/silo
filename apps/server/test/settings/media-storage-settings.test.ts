import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { ValidationError } from "@silo/shared/validation-error";
import { ConfigLoader } from "../../src/config/config-loader";
import { MediaStorageSettings } from "../../src/settings";

/**
 * Which value wins (D45).
 *
 * The rules worth getting right here are all about precedence, and every one of
 * them is a way to lie to an operator: a secret copied out of the environment
 * into a file, a derived path reported as an override and then saved back as a
 * literal, an env var quietly beating the field somebody just typed. None of
 * them needs a filesystem or a bucket to demonstrate, which is why this half is
 * separate from the supervisor.
 */
describe("MediaStorageSettings", () => {
  describe("parse", () => {
    test("a driver is required, and is matched case-insensitively", () => {
      expect(() => MediaStorageSettings.parse({})).toThrow(ValidationError);
      expect(() => MediaStorageSettings.parse({ driver: "  " })).toThrow(ValidationError);
      expect(MediaStorageSettings.parse({ driver: "S3" }).driver).toBe("s3");
    });

    test("values are trimmed, and the wrong type is refused", () => {
      const input = MediaStorageSettings.parse({
        driver: "s3",
        bucket: "  com-quicko-media\n",
        force_path_style: true,
      });
      expect(input.bucket).toBe("com-quicko-media");
      expect(input.force_path_style).toBe(true);

      expect(() => MediaStorageSettings.parse({ driver: "s3", bucket: 7 })).toThrow(
        ValidationError
      );
      expect(() =>
        MediaStorageSettings.parse({ driver: "s3", force_path_style: "yes" })
      ).toThrow(ValidationError);
    });

    test("an absent secret and a cleared one stay different", () => {
      expect(MediaStorageSettings.parse({ driver: "s3" }).secret_access_key).toBeUndefined();
      expect(
        MediaStorageSettings.parse({ driver: "s3", secret_access_key: "" }).secret_access_key
      ).toBe("");
    });
  });

  describe("merge", () => {
    const file = { driver: "s3", bucket: "old", secretAccessKey: "kept" };

    test("an omitted secret keeps the file's", () => {
      const merged = MediaStorageSettings.merge(
        file,
        MediaStorageSettings.parse({ driver: "s3", bucket: "new" })
      );
      expect(merged.bucket).toBe("new");
      expect(merged.secretAccessKey).toBe("kept");
    });

    test("an empty secret clears it", () => {
      const merged = MediaStorageSettings.merge(
        file,
        MediaStorageSettings.parse({ driver: "s3", bucket: "new", secret_access_key: "" })
      );
      expect(merged.secretAccessKey).toBeUndefined();
    });

    test("every other omitted field is cleared, because this is a document", () => {
      const merged = MediaStorageSettings.merge(
        { driver: "s3", bucket: "old", region: "ap-south-1" },
        MediaStorageSettings.parse({ driver: "fs", path: "/srv/media" })
      );
      expect(merged).toMatchObject({ driver: "fs", path: "/srv/media" });
      expect(merged.bucket).toBeUndefined();
      expect(merged.region).toBeUndefined();
    });
  });

  describe("overrides", () => {
    test("a set env var is named, even when it agrees with the file", () => {
      const file = { driver: "s3", bucket: "same" };
      const found = MediaStorageSettings.overrides(file, { ...file }, {
        SILO_BLOB_S3_BUCKET: "same",
      });
      expect(found).toEqual([{ field: "bucket", env: "SILO_BLOB_S3_BUCKET" }]);
    });

    test("a difference with no env var behind it is still reported", () => {
      const found = MediaStorageSettings.overrides(
        { driver: "fs", path: "/from-file" },
        { driver: "fs", path: "/from-a-flag" },
        {}
      );
      expect(found).toEqual([{ field: "path" }]);
    });

    test("the derived fs media path is not an override", () => {
      // Unset means "follow the data dir" (§10). Reporting the derivation would
      // put `<data>/media` in front of an operator as something to correct, and
      // saving it back would pin media in place.
      const found = MediaStorageSettings.overrides(
        { driver: "fs" },
        ConfigLoader.resolveDerivedDefaults(ConfigLoader.defaultConfig()).blob_storage,
        {}
      );
      expect(found).toEqual([]);
    });

    test("an instance with no [blob_storage] table reports nothing", () => {
      const found = MediaStorageSettings.overrides(
        null,
        ConfigLoader.defaultConfig().blob_storage,
        {}
      );
      expect(found).toEqual([]);
    });
  });

  test("facts never carry the secret, only whether there is one", () => {
    const facts = MediaStorageSettings.facts({
      driver: "s3",
      bucket: "b",
      accessKeyId: "AKIA…",
      secretAccessKey: "shhh",
    });
    expect(facts).toMatchObject({ driver: "s3", bucket: "b", access_key_id: "AKIA…" });
    expect(facts.secret_access_key_set).toBe(true);
    expect(JSON.stringify(facts)).not.toContain("shhh");

    expect(MediaStorageSettings.facts(null)).toEqual({
      driver: "fs",
      path: undefined,
      bucket: undefined,
      region: undefined,
      endpoint: undefined,
      access_key_id: undefined,
      secret_access_key_set: false,
    });
  });

  /**
   * The table is the whole point of `Fields`, and it is only useful while it
   * agrees with the loader. A field that gained an env var without gaining a row
   * here would be reported as decided by the file while the environment quietly
   * won — the failure this page exists to prevent.
   */
  test("every field's env var is the one ConfigLoader reads", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-fields-"));
    const configPath = path.join(dir, "silo.toml");
    const saved: Record<string, string | undefined> = {};
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("SILO_")) {
        saved[key] = process.env[key];
        delete process.env[key];
      }
    }

    try {
      for (const { key, env } of MediaStorageSettings.Fields) {
        const value = key === "forcePathStyle" ? "true" : `by-${env}`;
        process.env[env] = value;
        const config = await ConfigLoader.loadConfig(configPath, false);
        expect(config.blob_storage[key]).toBe(key === "forcePathStyle" ? (true as any) : value);
        delete process.env[env];
      }
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
