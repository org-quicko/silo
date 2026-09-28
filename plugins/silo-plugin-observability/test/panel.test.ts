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

  test("draws the database card from storage.database, and hides it when there is none", async () => {
    const source = await fs.readFile(
      path.resolve(import.meta.dir, "../src/panel/panel.html"),
      "utf8",
    );
    expect(source).toContain('id="database-card" class="card hidden"');
    expect(source).toContain("renderDatabase((snapshot.storage || {}).database || null)");
    expect(source).toContain("$('database-card').classList.toggle('hidden', !database)");
    for (const state of ["held", "retaking", "lost", "not_claimed"]) {
      expect(source).toContain(`${state}: [`);
    }
    // UI copy carries no em dash (the repo's rule for admin text).
    const card = source.slice(source.indexOf('<section id="database-card"'), source.indexOf("</section>", source.indexOf('<section id="database-card"')));
    const render = source.slice(source.indexOf("const OWNER_STATES"), source.indexOf("/* ---- polling ---- */"));
    expect(card + render).not.toContain("—");
  });
});
