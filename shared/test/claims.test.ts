import { describe, expect, test } from "bun:test";
import { Claims } from "../src/claims/claims";
import type { Claim } from "../src/claims/claim";
import type { CollectionPermission } from "../src/claims/collection-permission";

describe("claim matching", () => {
  test("collection wildcards match only the same explicit permission", () => {
    const claims = [Claims.collection(Claims.Root, Claims.Root, Claims.Root, Claims.CollectionEntriesRead)];
    expect(Claims.has(claims, Claims.collection("acme", "prod", "posts", Claims.CollectionEntriesRead))).toBe(true);
    expect(Claims.has(claims, Claims.collection("acme", "prod", "posts", Claims.CollectionEntriesUpdate))).toBe(false);
    expect(Claims.has(claims, Claims.collection(Claims.Root, Claims.Root, Claims.Root, Claims.CollectionEntriesRead))).toBe(true);
  });

  test("independent per-segment wildcards match correctly", () => {
    const projectScoped = [Claims.collection("acme", "*", "*", Claims.CollectionEntriesRead)];
    expect(Claims.has(projectScoped, Claims.collection("acme", "prod", "posts", Claims.CollectionEntriesRead))).toBe(true);
    expect(Claims.has(projectScoped, Claims.collection("acme", "dev", "comments", Claims.CollectionEntriesRead))).toBe(true);
    expect(Claims.has(projectScoped, Claims.collection("other", "prod", "posts", Claims.CollectionEntriesRead))).toBe(false);

    const envScoped = [Claims.collection("*", "prod", "*", Claims.CollectionEntriesRead)];
    expect(Claims.has(envScoped, Claims.collection("acme", "prod", "posts", Claims.CollectionEntriesRead))).toBe(true);
    expect(Claims.has(envScoped, Claims.collection("acme", "dev", "posts", Claims.CollectionEntriesRead))).toBe(false);

    const nameScoped = [Claims.collection("*", "*", "posts", Claims.CollectionEntriesRead)];
    expect(Claims.has(nameScoped, Claims.collection("acme", "prod", "posts", Claims.CollectionEntriesRead))).toBe(true);
    expect(Claims.has(nameScoped, Claims.collection("acme", "prod", "authors", Claims.CollectionEntriesRead))).toBe(false);
  });

  test("root covers fixed and future claims", () => {
    expect(Claims.has([Claims.Root], Claims.TransferCopy)).toBe(true);
    // Deliberately outside the Claim union: root must still cover claims minted
    // by a newer silo than the one doing the checking.
    expect(Claims.has([Claims.Root], "future:capability" as Claim)).toBe(true);
  });

  test("a bare collection permission is not a whole claim", () => {
    // @ts-expect-error — Claims.CollectionEntriesRead is the "entries:read"
    // fragment, not a claim; passing it here would silently never match.
    Claims.has([Claims.Root], Claims.CollectionEntriesRead);
    // The fragment only becomes a claim once scoped to a project, env, and collection.
    expect(Claims.has([Claims.Root], Claims.collection("acme", "prod", "posts", Claims.CollectionEntriesRead))).toBe(true);
  });

  test("normalization validates, deduplicates, sorts, and reduces root", () => {
    expect(() => Claims.normalize(["keys:*"])).toThrow(/invalid claim/);
    expect(() => Claims.normalize(["collections:posts:entries:*"])).toThrow(/invalid claim/);
    expect(() => Claims.normalize(["collections:acme/prod/posts:*"])).toThrow(/invalid claim/);
    expect(Claims.normalize([Claims.MediaRead, Claims.KeysRead, Claims.MediaRead])).toEqual([
      Claims.KeysRead,
      Claims.MediaRead,
    ]);
    expect(Claims.normalize([Claims.MediaRead, Claims.Root])).toEqual([Claims.Root]);
  });

  test("delegation cannot exceed the caller (non-escalating delegation)", () => {
    const own = [
      Claims.KeysCreate,
      Claims.collection("acme", "*", "*", Claims.CollectionEntriesRead),
    ];
    // Can delegate to a specific env/collection within the permitted project
    expect(Claims.canDelegate(own, [Claims.collection("acme", "prod", "posts", Claims.CollectionEntriesRead)])).toBe(true);
    expect(Claims.canDelegate(own, [Claims.collection("acme", "prod", "*", Claims.CollectionEntriesRead)])).toBe(true);
    // Cannot delegate different permissions
    expect(Claims.canDelegate(own, [Claims.collection("acme", "prod", "posts", Claims.CollectionEntriesUpdate)])).toBe(false);
    // Cannot widen project scope
    expect(Claims.canDelegate(own, [Claims.collection("*", "*", "*", Claims.CollectionEntriesRead)])).toBe(false);
    expect(Claims.canDelegate(own, [Claims.collection("other", "prod", "posts", Claims.CollectionEntriesRead)])).toBe(false);
    expect(Claims.canDelegate(own, [Claims.Root])).toBe(false);

    // Named cannot widen to wildcard
    const exact = [
      Claims.KeysCreate,
      Claims.collection("acme", "prod", "posts", Claims.CollectionEntriesRead),
    ];
    expect(Claims.canDelegate(exact, [Claims.collection("acme", "prod", "posts", Claims.CollectionEntriesRead)])).toBe(true);
    expect(Claims.canDelegate(exact, [Claims.collection("acme", "prod", "*", Claims.CollectionEntriesRead)])).toBe(false);
    expect(Claims.canDelegate(exact, [Claims.collection("acme", "*", "*", Claims.CollectionEntriesRead)])).toBe(false);
  });

  test("preset names are recognized from one catalog", () => {
    expect(Claims.isPreset("write")).toBe(true);
    expect(Claims.isPreset("auditor")).toBe(false);
    expect(Claims.fromPreset("root")).toEqual([Claims.Root]);
    const write = Claims.fromPreset("write", ["acme/prod/posts"]);
    expect(write).toContain(Claims.MediaDelete);
    expect(write).toContain(Claims.collection("acme", "prod", "posts", Claims.CollectionEntriesDelete));
    expect(write).not.toContain(Claims.collection("acme", "prod", "posts", Claims.CollectionDelete));
  });

  test("normalize rejects non-arrays", () => {
    expect(() => Claims.normalize("keys:read")).toThrow(/must be an array/);
    expect(() => Claims.normalize(undefined)).toThrow(/must be an array/);
    expect(() => Claims.normalize([42])).toThrow(/invalid claim/);
  });

  test("every catalogued claim validates", () => {
    // Guards the lookup tables against drifting from the constants above them.
    const fixed = [
      Claims.KeysRead, Claims.KeysCreate, Claims.KeysRevoke, Claims.KeysExport, Claims.KeysImport,
      Claims.TransferExport, Claims.TransferImport, Claims.TransferCopy,
      Claims.MediaRead, Claims.MediaCreate, Claims.MediaDelete,
    ];
    for (const claim of fixed) expect(Claims.isValid(claim)).toBe(true);
    const permissions: CollectionPermission[] = [
      Claims.CollectionCreate, Claims.CollectionDelete,
      Claims.CollectionSchemaRead, Claims.CollectionSchemaUpdate, Claims.CollectionAccessUpdate,
      Claims.CollectionEntriesCreate, Claims.CollectionEntriesRead,
      Claims.CollectionEntriesUpdate, Claims.CollectionEntriesDelete,
    ];
    for (const permission of permissions) {
      expect(Claims.isValid(Claims.collection("acme", "prod", "posts", permission))).toBe(true);
      expect(Claims.isValid(Claims.collection(Claims.Root, Claims.Root, Claims.Root, permission))).toBe(true);
    }
  });

  test("inherited object keys never validate as claims", () => {
    // The lookup tables are plain objects; `in` would accept these.
    expect(Claims.isValid("collections:acme/prod/posts:constructor")).toBe(false);
    expect(Claims.isValid("constructor")).toBe(false);
    expect(Claims.isValid("toString")).toBe(false);
  });

  test("presets and collection capability discovery use the shared catalog", () => {
    const read = Claims.fromPreset("read", ["acme/prod/posts"]);
    expect(read).toContain(Claims.MediaRead);
    expect(read).toContain(Claims.collection("acme", "prod", "posts", Claims.CollectionSchemaRead));
    expect(read).not.toContain(Claims.collection("acme", "prod", "posts", Claims.CollectionEntriesCreate));
    expect(Claims.hasAnyCollectionPermission(
      [Claims.collection("acme", "prod", "posts", Claims.CollectionCreate)],
      Claims.CollectionCreate,
      "acme",
      "prod",
    )).toBe(true);
    expect(Claims.hasAnyCollectionPermission(
      [Claims.collection("acme", "prod", "posts", Claims.CollectionCreate)],
      Claims.CollectionCreate,
      "other",
      "prod",
    )).toBe(false);
    expect(Claims.isCollectionName("public_posts")).toBe(true);
    expect(Claims.isCollectionName("PublicPosts")).toBe(false);
  });

  test("hasInstanceWide only accepts authority over every scope", () => {
    const scoped = [
      Claims.collection("acme", "*", "*", Claims.CollectionEntriesRead),
      Claims.collection("acme", "*", "*", Claims.CollectionSchemaRead),
    ];
    expect(Claims.hasInstanceWide(scoped, Claims.TransferReadPermissions)).toBe(false);

    const wide = [
      Claims.collection("*", "*", "*", Claims.CollectionEntriesRead),
      Claims.collection("*", "*", "*", Claims.CollectionSchemaRead),
    ];
    expect(Claims.hasInstanceWide(wide, Claims.TransferReadPermissions)).toBe(true);
    // Every listed permission is required, not just one of them.
    expect(Claims.hasInstanceWide(wide.slice(0, 1), Claims.TransferReadPermissions)).toBe(false);
    expect(Claims.hasInstanceWide(wide, Claims.TransferWritePermissions)).toBe(false);

    expect(Claims.hasInstanceWide([Claims.Root], Claims.TransferWritePermissions)).toBe(true);
  });

  test("hasScopeWide accepts a wider grant but not a narrower one", () => {
    const project = [
      Claims.collection("acme", "*", "*", Claims.CollectionEntriesRead),
      Claims.collection("acme", "*", "*", Claims.CollectionSchemaRead),
    ];
    // A project-wide grant covers any one of that project's environments —
    // this is what lets a project-confined key copy dev→prod (D22).
    expect(Claims.hasScopeWide(project, Claims.ScopeCopyReadPermissions, "acme", "prod")).toBe(true);
    expect(Claims.hasScopeWide(project, Claims.ScopeCopyReadPermissions, "other", "prod")).toBe(false);

    // A single collection is narrower than the scope, so it does not satisfy
    // a whole-scope operation.
    const oneCollection = [
      Claims.collection("acme", "prod", "posts", Claims.CollectionEntriesRead),
      Claims.collection("acme", "prod", "posts", Claims.CollectionSchemaRead),
    ];
    expect(Claims.hasScopeWide(oneCollection, Claims.ScopeCopyReadPermissions, "acme", "prod")).toBe(false);

    // Every listed permission is required, not just one of them.
    expect(Claims.hasScopeWide(project.slice(0, 1), Claims.ScopeCopyReadPermissions, "acme", "prod")).toBe(false);
    expect(Claims.hasScopeWide(project, Claims.ScopeCopyWritePermissions, "acme", "prod")).toBe(false);

    expect(Claims.hasScopeWide([Claims.Root], Claims.ScopeCopyReplacePermissions, "acme", "prod")).toBe(true);
  });
});
