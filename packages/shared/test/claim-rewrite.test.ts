import { describe, expect, test } from "bun:test";
import { ClaimRewrite, type ScopeRename } from "../src/claims/claim-rewrite";

const projectRename: ScopeRename = {
  subject: "project",
  from: "acme",
  to: "globex",
  project: "acme",
};

const envRename: ScopeRename = {
  subject: "environment",
  from: "dev",
  to: "staging",
  project: "acme",
  env: "dev",
};

const collectionRename: ScopeRename = {
  subject: "collection",
  from: "posts",
  to: "articles",
  project: "acme",
  env: "dev",
};

describe("ClaimRewrite", () => {
  describe("a literal segment is a reference and is rewritten", () => {
    test("a project rename moves the first segment", () => {
      const outcome = ClaimRewrite.rewrite("collections:acme/dev/posts:entries:read", projectRename);
      expect(outcome.claim).toBe("collections:globex/dev/posts:entries:read");
      expect(outcome.rewritten).toBe(true);
      expect(outcome.patternAffected).toBe(false);
    });

    test("an environment rename moves the second, when the project matches", () => {
      const outcome = ClaimRewrite.rewrite("collections:acme/dev/posts:entries:read", envRename);
      expect(outcome.claim).toBe("collections:acme/staging/posts:entries:read");
      expect(outcome.rewritten).toBe(true);
    });

    test("a collection rename moves the third, when both parents match", () => {
      const outcome = ClaimRewrite.rewrite(
        "collections:acme/dev/posts:entries:read",
        collectionRename
      );
      expect(outcome.claim).toBe("collections:acme/dev/articles:entries:read");
      expect(outcome.rewritten).toBe(true);
    });

    test("a permission containing a colon survives intact", () => {
      // `entries:read` has a colon of its own, which is why the suffix is taken
      // from the second colon rather than by splitting on every one.
      expect(
        ClaimRewrite.rewrite("collections:acme/dev/posts:entries:update", projectRename).claim
      ).toBe("collections:globex/dev/posts:entries:update");
      expect(
        ClaimRewrite.rewrite("collections:acme/dev/posts:collections:schema:update", projectRename)
          .claim
      ).toBe("collections:globex/dev/posts:collections:schema:update");
    });

    test("hook claims move on the same three segments", () => {
      const outcome = ClaimRewrite.rewrite("hooks:acme/dev/posts:entry.afterWrite", envRename);
      expect(outcome.claim).toBe("hooks:acme/staging/posts:entry.afterWrite");
      expect(outcome.rewritten).toBe(true);
    });

    test("a wildcard in a *descendant* segment does not stop the rewrite", () => {
      expect(ClaimRewrite.rewrite("collections:acme/*/*:entries:read", projectRename).claim).toBe(
        "collections:globex/*/*:entries:read"
      );
      expect(ClaimRewrite.rewrite("collections:acme/dev/*:entries:read", envRename).claim).toBe(
        "collections:acme/staging/*:entries:read"
      );
    });
  });

  describe("a wildcard ancestor makes the claim a pattern, never rewritten", () => {
    test("an environment rename leaves */dev/* alone and reports it", () => {
      // Rewriting this to `*/staging/*` would change authority in every project
      // on the instance. Leaving it is correct and still changes what the key
      // reaches, so it is disclosed instead.
      const outcome = ClaimRewrite.rewrite("collections:*/dev/*:entries:read", envRename);
      expect(outcome.claim).toBe("collections:*/dev/*:entries:read");
      expect(outcome.rewritten).toBe(false);
      expect(outcome.patternAffected).toBe(true);
    });

    test("a collection rename leaves either wildcard parent alone", () => {
      expect(
        ClaimRewrite.rewrite("collections:*/dev/posts:entries:read", collectionRename)
      ).toMatchObject({ rewritten: false, patternAffected: true });
      expect(
        ClaimRewrite.rewrite("collections:acme/*/posts:entries:read", collectionRename)
      ).toMatchObject({ rewritten: false, patternAffected: true });
    });

    test("a project rename has no wildcard ancestor to worry about", () => {
      // The project segment is outermost, so a claim naming it literally is
      // always about this one project.
      const outcome = ClaimRewrite.rewrite("collections:acme/*/*:entries:read", projectRename);
      expect(outcome.rewritten).toBe(true);
      expect(outcome.patternAffected).toBe(false);
    });
  });

  describe("claims about something else are untouched", () => {
    test("a wildcard in the renamed segment itself still matches after the rename", () => {
      for (const claim of [
        "collections:*/*/*:entries:read",
        "collections:*/dev/posts:entries:read",
      ]) {
        expect(ClaimRewrite.rewrite(claim, projectRename)).toMatchObject({
          claim,
          rewritten: false,
          patternAffected: false,
        });
      }
    });

    test("a literal ancestor naming a different entity", () => {
      // `globex`'s own `dev` is not `acme`'s, so renaming the latter must not
      // touch a claim about the former.
      const claim = "collections:globex/dev/posts:entries:read";
      expect(ClaimRewrite.rewrite(claim, envRename)).toMatchObject({
        claim,
        rewritten: false,
        patternAffected: false,
      });
    });

    test("a same-named entity at the wrong depth", () => {
      // A collection called `dev` is not the environment called `dev`.
      const claim = "collections:acme/prod/dev:entries:read";
      expect(ClaimRewrite.rewrite(claim, envRename)).toMatchObject({
        claim,
        rewritten: false,
      });
    });

    test("root and fixed claims carry no scope", () => {
      for (const claim of ["*", "media:read", "keys:create", "transfer:export"]) {
        expect(ClaimRewrite.rewrite(claim, projectRename)).toMatchObject({
          claim,
          rewritten: false,
          patternAffected: false,
        });
      }
    });

    test("a malformed claim is returned as it came", () => {
      for (const claim of ["collections:acme/dev:entries:read", "collections:", "nonsense"]) {
        expect(ClaimRewrite.rewrite(claim, projectRename).claim).toBe(claim);
      }
    });
  });

  describe("plan", () => {
    test("partitions a list and rewrites in place", () => {
      const plan = ClaimRewrite.plan(
        [
          "collections:acme/dev/posts:entries:read",
          "collections:*/dev/*:entries:read",
          "collections:*/*/*:entries:read",
          "media:read",
        ],
        envRename
      );

      expect(plan.claims).toEqual([
        "collections:acme/staging/posts:entries:read",
        "collections:*/dev/*:entries:read",
        "collections:*/*/*:entries:read",
        "media:read",
      ]);
      expect(plan.rewritten).toEqual(["collections:acme/dev/posts:entries:read"]);
      expect(plan.patternAffected).toEqual(["collections:*/dev/*:entries:read"]);
    });

    test("is idempotent, which is what makes a crashed cascade safe to replay", () => {
      const once = ClaimRewrite.plan(["collections:acme/dev/posts:entries:read"], envRename);
      const twice = ClaimRewrite.plan(once.claims, envRename);

      expect(twice.claims).toEqual(once.claims);
      expect(twice.rewritten).toEqual([]);
    });
  });
});
