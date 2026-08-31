import { afterEach, describe, expect, test } from "bun:test";
import { ValidationError } from "@silo/shared/validation-error";
import { ConfigLoader } from "../../src/config/config-loader";
import type { MediaConfig } from "../../src/config/media-config";
import { MediaPolicySettings } from "../../src/settings";

const inForce = (patch: Partial<MediaConfig> = {}): MediaConfig => ({
  base_url_target: "server",
  extensions: ["jpg", "png"],
  ...patch,
});

/**
 * Which media setting wins (D46).
 *
 * The rules worth pinning are all about not lying to the operator: the form
 * edits the file, the environment outranks the file, and a field the file does
 * not decide has to say so — otherwise somebody types a CDN hostname, watches
 * it save, and the instance keeps handing out links to another one.
 */
describe("MediaPolicySettings", () => {
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
    test("a base URL has to be absolute, because a relative one silently does nothing", () => {
      expect(() => MediaPolicySettings.parse({ base_url: "/uploads" })).toThrow(ValidationError);
      expect(() => MediaPolicySettings.parse({ base_url: "cdn.example.com" })).toThrow(
        /absolute URL/
      );
    });

    test("and it has to be http or https", () => {
      expect(() => MediaPolicySettings.parse({ base_url: "ftp://cdn.example.com" })).toThrow(
        /http or https/
      );
    });

    test("a path on the base is fine: a CDN often serves a library under one", () => {
      expect(MediaPolicySettings.parse({ base_url: "https://cdn.example.com/assets" })).toEqual({
        base_url: "https://cdn.example.com/assets",
      });
    });

    test("an empty base URL is how it is cleared", () => {
      expect(MediaPolicySettings.parse({ base_url: "   " })).toEqual({ base_url: "" });
    });

    test("an unknown target is refused rather than defaulted", () => {
      expect(() => MediaPolicySettings.parse({ base_url_target: "bucket" })).toThrow(
        /"server" or "store"/
      );
    });

    test("an empty allowlist is refused, since it accepts nothing", () => {
      expect(() => MediaPolicySettings.parse({ extensions: [] })).toThrow(/cannot be empty/);
      expect(() => MediaPolicySettings.parse({ extensions: ["", " "] })).toThrow(/\["\*"\]/);
    });
  });

  describe("merge", () => {
    test("the base is the file, so nothing is copied out of the environment into it", () => {
      const merged = MediaPolicySettings.merge(
        { base_url: "https://old.example.com", extensions: ["jpg"] },
        { base_url_target: "store" }
      );
      expect(merged).toEqual({
        base_url: "https://old.example.com",
        base_url_target: "store",
        extensions: ["jpg"],
      });
    });

    test("an empty base URL clears the file's, rather than being ignored", () => {
      const merged = MediaPolicySettings.merge({ base_url: "https://old.example.com" }, {
        base_url: "",
      });
      expect(merged.base_url).toBeUndefined();
    });
  });

  describe("overrides", () => {
    test("a field the file decides has nothing to report", () => {
      expect(
        MediaPolicySettings.overrides({ base_url: "https://a.example.com" }, inForce({ base_url: "https://a.example.com" }))
      ).toEqual([]);
    });

    test("an environment variable is named whenever it is set", () => {
      withEnv("SILO_MEDIA_BASE_URL", "https://env.example.com");
      expect(MediaPolicySettings.overrides(null, inForce())).toEqual([
        { field: "base_url", env: "SILO_MEDIA_BASE_URL" },
      ]);
    });

    test("a file with no [media] at all is agreeing with the defaults, not being beaten", () => {
      expect(MediaPolicySettings.overrides(null, inForce())).toEqual([]);
      expect(MediaPolicySettings.overrides({}, inForce())).toEqual([]);
    });

    test("a value that differs with no variable set is still reported, unnamed", () => {
      // A flag, or a file edited by hand since the process started. Neither can
      // be named, and both mean the same thing: the file is not what is in use.
      expect(
        MediaPolicySettings.overrides({ extensions: ["jpg"] }, inForce({ extensions: ["png"] }))
      ).toEqual([{ field: "extensions" }]);
    });
  });

  test("every field the loader reads from the environment is one this reports", () => {
    // The failure this catches: a field appears in the form and in the writer
    // while nothing tells the operator which variable has been quietly winning.
    const loader = ConfigLoader.toString();
    for (const { env } of MediaPolicySettings.Fields) {
      expect(loader).toContain(env);
    }
  });
});
