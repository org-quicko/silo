import { describe, expect, test } from "bun:test";
import { KeyFormat } from "../src/keys/key-format";

describe("key format", () => {
  test("display prefix matches what the server stores on a key record", () => {
    const secret = KeyFormat.Prefix + "abcdefghijklmnopqrstuvwxyz";
    expect(KeyFormat.displayPrefix(secret)).toBe("silo_abcdefg…");
    expect(KeyFormat.displayPrefix(secret)).toHaveLength(KeyFormat.DisplayLength + 1);
  });

  test("recognizes its own prefix", () => {
    expect(KeyFormat.looksLikeKey(KeyFormat.Prefix + "whatever")).toBe(true);
    expect(KeyFormat.looksLikeKey("bearer-token")).toBe(false);
    expect(KeyFormat.looksLikeKey("")).toBe(false);
  });

  test("short secrets do not throw or over-truncate", () => {
    expect(KeyFormat.displayPrefix("silo_")).toBe("silo_…");
  });
});
