import { describe, expect, test } from "bun:test";
import { ClaimSegment } from "../src/claims/claim-segment";
import { Claims } from "../src/claims/claims";

describe("ClaimSegment.matches", () => {
  test("a wildcard admits anything", () => {
    expect(ClaimSegment.matches("*", "acme")).toBe(true);
    expect(ClaimSegment.matches("*", "")).toBe(true);
  });

  test("a literal admits only itself", () => {
    expect(ClaimSegment.matches("acme", "acme")).toBe(true);
    expect(ClaimSegment.matches("acme", "acme-web")).toBe(false);
    expect(ClaimSegment.matches("acme", "acm")).toBe(false);
  });

  test("a prefix admits every name that starts with it, itself included", () => {
    expect(ClaimSegment.matches("acme*", "acme")).toBe(true);
    expect(ClaimSegment.matches("acme*", "acme-web")).toBe(true);
    expect(ClaimSegment.matches("acme*", "acm")).toBe(false);
    expect(ClaimSegment.matches("acme*", "beta")).toBe(false);
  });
});

describe("ClaimSegment.covers", () => {
  test("a wildcard covers every spelling", () => {
    for (const required of ["*", "acme", "acme*"]) {
      expect(ClaimSegment.covers("*", required)).toBe(true);
    }
  });

  /** The rule the whole grammar rests on: nothing widens to a wildcard. */
  test("nothing but a wildcard covers a wildcard", () => {
    expect(ClaimSegment.covers("acme", "*")).toBe(false);
    expect(ClaimSegment.covers("acme*", "*")).toBe(false);
  });

  test("a prefix covers the names under it", () => {
    expect(ClaimSegment.covers("acme*", "acme")).toBe(true);
    expect(ClaimSegment.covers("acme*", "acme-web")).toBe(true);
    expect(ClaimSegment.covers("acme*", "beta")).toBe(false);
  });

  test("a prefix covers a narrower prefix and not a wider one", () => {
    expect(ClaimSegment.covers("acm*", "acme*")).toBe(true);
    expect(ClaimSegment.covers("acm*", "acm*")).toBe(true);
    // `ac*` admits `axe`, which `acm*` does not, so it is genuinely wider.
    expect(ClaimSegment.covers("acm*", "ac*")).toBe(false);
  });

  test("a literal covers only itself, never a prefix that contains it", () => {
    expect(ClaimSegment.covers("acme", "acme")).toBe(true);
    expect(ClaimSegment.covers("acme", "acme*")).toBe(false);
  });
});

describe("ClaimSegment.narrow", () => {
  test("an unasked segment passes through as it is", () => {
    expect(ClaimSegment.narrow("acme*", undefined)).toBe("acme*");
  });

  test("a matching pattern resolves to the concrete name that was asked for", () => {
    expect(ClaimSegment.narrow("acme*", "acme-web")).toBe("acme-web");
    expect(ClaimSegment.narrow("*", "acme-web")).toBe("acme-web");
  });

  test("a pattern that does not match drops the target entirely", () => {
    expect(ClaimSegment.narrow("acme*", "beta")).toBeNull();
    expect(ClaimSegment.narrow("acme", "beta")).toBeNull();
  });
});

describe("ClaimSegment.sql", () => {
  test("a wildcard emits no clause, because it constrains nothing", () => {
    expect(ClaimSegment.sql("p.project_name", "*")).toBeNull();
  });

  test("a literal compares for equality", () => {
    expect(ClaimSegment.sql("p.project_name", "acme")).toEqual({
      clause: "p.project_name = ?",
      args: ["acme"],
    });
  });

  /** GLOB, not LIKE: LIKE is case-insensitive for ASCII and treats `_` — a
   *  legal character in an id — as a single-character wildcard. */
  test("a prefix compares with GLOB", () => {
    expect(ClaimSegment.sql("p.project_name", "acme*")).toEqual({
      clause: "p.project_name GLOB ?",
      args: ["acme*"],
    });
  });
});

describe("the grammar", () => {
  test("accepts a prefix pattern in any of the three segments", () => {
    expect(Claims.isValid("collections:acme*/prod/*:entries:read")).toBe(true);
    expect(Claims.isValid("collections:*/prev*/*:entries:read")).toBe(true);
    expect(Claims.isValid("collections:acme/prod/cms_*:entries:read")).toBe(true);
    expect(Claims.isValid("hooks:acme*/prod/*:entry.afterWrite")).toBe(true);
  });

  /** A one- or two-character prefix is `*` wearing a disguise: it reads as
   *  narrow and grants nearly everything. */
  test("refuses a prefix shorter than three characters", () => {
    expect(Claims.isValid("collections:a*/prod/*:entries:read")).toBe(false);
    expect(Claims.isValid("collections:ac*/prod/*:entries:read")).toBe(false);
    expect(Claims.isValid("collections:acm*/prod/*:entries:read")).toBe(true);
  });

  test("refuses a wildcard anywhere but the end of a segment", () => {
    expect(Claims.isValid("collections:*cme/prod/*:entries:read")).toBe(false);
    expect(Claims.isValid("collections:ac*me/prod/*:entries:read")).toBe(false);
    expect(Claims.isValid("collections:acme**/prod/*:entries:read")).toBe(false);
  });

  test("refuses a pattern in the permission, which is not a scope", () => {
    expect(Claims.isValid("collections:acme/prod/*:entries:*")).toBe(false);
    expect(Claims.isValid("collections:acme/prod/*:entr*")).toBe(false);
  });

  test("parses a pattern segment as itself, not as a wildcard", () => {
    const parsed = Claims.parse("collections:acme*/prod/*:entries:read");
    expect(parsed.project).toBe("acme*");
    expect(parsed.env).toBe("prod");
    expect(parsed.name).toBe("*");
  });

  test("isScopeId still refuses a pattern, which is never the name of a thing", () => {
    expect(Claims.isScopeId("acme*")).toBe(false);
    expect(Claims.isScopeId("acme")).toBe(true);
  });
});

describe("authorization over a pattern", () => {
  const held = ["collections:acme*/prod/*:entries:read"];

  test("grants the names under the prefix", () => {
    expect(Claims.has(held, Claims.collection("acme-web", "prod", "posts", "entries:read"))).toBe(true);
    expect(Claims.has(held, Claims.collection("acme", "prod", "posts", "entries:read"))).toBe(true);
  });

  test("grants nothing outside it", () => {
    expect(Claims.has(held, Claims.collection("beta", "prod", "posts", "entries:read"))).toBe(false);
    expect(Claims.has(held, Claims.collection("acme-web", "dev", "posts", "entries:read"))).toBe(false);
  });

  test("does not leak across the permission", () => {
    expect(Claims.has(held, Claims.collection("acme-web", "prod", "posts", "entries:delete"))).toBe(false);
  });

  test("delegation may narrow a prefix but never widen it", () => {
    expect(Claims.canDelegate(held, ["collections:acme-web*/prod/*:entries:read"])).toBe(true);
    expect(Claims.canDelegate(held, ["collections:acme-web/prod/posts:entries:read"])).toBe(true);
    expect(Claims.canDelegate(held, ["collections:acm*/prod/*:entries:read"])).toBe(false);
    expect(Claims.canDelegate(held, ["collections:*/prod/*:entries:read"])).toBe(false);
  });

  test("a scope-wide question is answered by a pattern that covers the scope", () => {
    expect(Claims.hasScopeWide(held, ["entries:read"], "acme-web", "prod")).toBe(true);
    expect(Claims.hasScopeWide(held, ["entries:read"], "beta", "prod")).toBe(false);
  });

  test("an instance-wide question is never answered by a pattern", () => {
    expect(Claims.hasInstanceWide(held, ["entries:read"])).toBe(false);
  });

  test("normalize keeps a pattern and still sorts and deduplicates", () => {
    expect(
      Claims.normalize([
        "collections:acme*/prod/*:entries:read",
        "collections:acme*/prod/*:entries:read",
      ]),
    ).toEqual(["collections:acme*/prod/*:entries:read"]);
  });

  test("root still absorbs a pattern", () => {
    expect(Claims.normalize(["*", "collections:acme*/prod/*:entries:read"])).toEqual(["*"]);
  });
});
