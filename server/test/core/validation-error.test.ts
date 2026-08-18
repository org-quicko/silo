import { describe, expect, test } from "bun:test";
import fs from "fs";
import path from "path";
import { Claims } from "@silo/shared/claims";
import { ValidationError } from "@silo/shared/validation-error";

/**
 * These are the checks the server depends on but the shared package cannot make
 * for itself: that an error raised *inside* `@silo/shared` is still recognized
 * by a catch site outside it, and that there is exactly one copy of the module
 * on disk no matter which install root reaches for it.
 */
describe("validation error across the shared package boundary", () => {
  const repoRoot = path.resolve(import.meta.dir, "../../..");

  test("an error raised by Claims.normalize is recognized here", () => {
    let caught: unknown = null;
    try {
      Claims.normalize(["keys:*"]);
    } catch (err) {
      caught = err;
    }

    expect(ValidationError.is(caught)).toBe(true);
    expect((caught as ValidationError).message).toContain("keys:*");
    expect((caught as ValidationError).details).toEqual([]);
  });

  test("the shared package resolves to one on-disk copy from every install root", () => {
    // `ui/` is a second install root and `shared/` is the package's own; if any
    // of them ever resolved to a private copy — the `file:` protocol duplicates
    // rather than symlinks — errors raised through one copy would be invisible
    // to `instanceof` checks against the other. That is the bug this catches.
    const roots = [repoRoot, path.join(repoRoot, "shared"), path.join(repoRoot, "ui")];
    const modules = [
      { subpath: "@silo/shared/validation-error", source: "shared/src/errors/validation-error.ts" },
      // Claims raises ValidationError through a relative import, so a duplicate
      // claims.ts would drag a duplicate validation-error.ts along with it.
      { subpath: "@silo/shared/claims", source: "shared/src/claims/claims.ts" },
    ];

    for (const { subpath, source } of modules) {
      const expected = fs.realpathSync(path.join(repoRoot, source));
      for (const root of roots) {
        const resolved = fs.realpathSync(Bun.resolveSync(subpath, root));
        expect(`${root} -> ${resolved}`).toBe(`${root} -> ${expected}`);
      }
    }
  });
});
