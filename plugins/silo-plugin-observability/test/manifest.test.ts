import { describe, expect, test } from "bun:test";
import manifest from "../package.json";

describe("the static manifest", () => {
  test("declares the panel, its one route, and the read-only metrics claim", () => {
    expect(manifest.silo.contributes.ui.entry).toBe("./src/panel/panel.html");
    expect(manifest.silo.contributes.routes).toEqual([{ method: "GET", path: "/snapshot" }]);
    expect(manifest.silo.permissions.required.map((entry) => entry.claim)).toEqual([
      "observability:read",
    ]);
  });

  test("asks for collection names only as an optional grant, and the least of the read permissions", () => {
    // D99: the snapshot names only scopes the caller's claims reach, and the
    // panel's caller is the plugin, so this is what turns names on.
    expect(manifest.silo.permissions.optional.map((entry) => entry.claim)).toEqual([
      "collections:*/*/*:schema:read",
    ]);
  });
});
