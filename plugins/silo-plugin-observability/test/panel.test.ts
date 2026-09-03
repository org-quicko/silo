import { describe, expect, test } from "bun:test";
import fs from "fs/promises";
import path from "path";

describe("the observability panel", () => {
  test("is one dependency-free document with loading, empty, and refresh states", async () => {
    const source = await fs.readFile(
      path.resolve(import.meta.dir, "../src/panel/panel.html"),
      "utf8",
    );
    expect(Buffer.byteLength(source)).toBeLessThan(2 * 1024 * 1024);
    expect(source).toContain("silo.fetch('/snapshot')");
    expect(source).toContain("No API traffic recorded yet.");
    expect(source).toContain("Loading a snapshot…");
    expect(source).toContain("Pause");
    expect(source).not.toMatch(/<(?:script|link)[^>]+(?:src|href)=/i);
  });
});
