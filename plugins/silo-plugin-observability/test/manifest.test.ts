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
});
