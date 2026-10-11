import { describe, expect, test } from "bun:test";
import { Claims } from "../src/claims/claims";
import { CollectionName } from "../src/claims/collection-name";

/** Collection names may be longer than project and env ids (D104), and every
 *  one of them can still be named in a claim. */
describe("collection names", () => {
  const longest = `a${"b".repeat(CollectionName.MaxLength - 1)}`;

  test("take up to 128 characters, where a scope id stays at 64", () => {
    expect(CollectionName.MaxLength).toBe(128);
    expect(Claims.isCollectionName(longest)).toBe(true);
    expect(Claims.isCollectionName(`${longest}c`)).toBe(false);
    expect(Claims.isScopeId("a".repeat(64))).toBe(true);
    expect(Claims.isScopeId("a".repeat(65))).toBe(false);
  });

  test("the longest name is a claim segment, literal and as a prefix", () => {
    const claim = Claims.collection("acme", "prod", longest, Claims.CollectionEntriesRead);
    expect(Claims.isValid(claim)).toBe(true);
    expect(Claims.has([claim], claim)).toBe(true);
    const prefix = `collections:acme/prod/${longest.slice(0, CollectionName.MaxLength - 1)}*:entries:read`;
    expect(Claims.isValid(prefix)).toBe(true);
    expect(Claims.has([prefix], claim)).toBe(true);
    // The project and env segments keep their own ceiling.
    expect(Claims.isValid(`collections:${"a".repeat(65)}/prod/posts:entries:read`)).toBe(false);
    expect(Claims.isValid(`collections:acme/prod/${longest}c:entries:read`)).toBe(false);
  });

  test("a hook claim takes the same collection segment", () => {
    expect(Claims.isValid(`hooks:acme/prod/${longest}:entry.afterWrite`)).toBe(true);
  });

  test("say what is wrong, without repeating the name", () => {
    expect(CollectionName.problem("posts")).toBeNull();
    expect(CollectionName.problem("")).toBe("the name is empty");
    expect(CollectionName.problem(`${longest}c`)).toBe("the name has 129 characters, and the most is 128");
    expect(CollectionName.problem("2024_posts")).toBe("the name must start with a lowercase letter");
    expect(CollectionName.problem("Posts")).toBe("the name must start with a lowercase letter");
    expect(CollectionName.problem("blog.posts")).toBe('the name can only have lowercase letters, digits, "-" and "_"');
  });
});
