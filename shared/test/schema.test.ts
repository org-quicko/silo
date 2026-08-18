import { describe, expect, test } from "bun:test";
import { MediaField } from "../src/schema/media-field";
import { SchemaAccess } from "../src/schema/schema-access";
import { SiloRef } from "../src/schema/silo-ref";

describe("silo ref scheme", () => {
  test("round-trips a collection name", () => {
    expect(SiloRef.url("posts")).toBe("silo://collections/posts");
    expect(SiloRef.collectionOf(SiloRef.url("posts"))).toBe("posts");
  });

  test("strips fragments when naming the target collection", () => {
    expect(SiloRef.collectionOf("silo://collections/posts#/$defs/x")).toBe("posts");
    expect(SiloRef.collectionOf("silo://collections/posts/extra")).toBe("posts");
  });

  test("classifies local, remote, and neither", () => {
    expect(SiloRef.isLocal(SiloRef.url("posts"))).toBe(true);
    expect(SiloRef.isLocal("https://example.com/s.json")).toBe(false);
    expect(SiloRef.isRemote("https://example.com/s.json")).toBe(true);
    expect(SiloRef.isRemote("http://example.com/s.json")).toBe(true);
    expect(SiloRef.isRemote("#/$defs/local")).toBe(false);
    expect(SiloRef.isLocal("#/$defs/local")).toBe(false);
    // Non-strings reach these from untrusted schema documents.
    expect(SiloRef.isLocal(undefined)).toBe(false);
    expect(SiloRef.isRemote(42)).toBe(false);
  });
});

describe("schema access", () => {
  test("only an explicit true requires auth", () => {
    expect(SchemaAccess.requiresAuth({ "x-silo-auth": true })).toBe(true);
    expect(SchemaAccess.requiresAuth({ "x-silo-auth": false })).toBe(false);
    expect(SchemaAccess.requiresAuth({ "x-silo-auth": "true" })).toBe(false);
    expect(SchemaAccess.requiresAuth({})).toBe(false);
    expect(SchemaAccess.requiresAuth(null)).toBe(false);
    expect(SchemaAccess.requiresAuth(undefined)).toBe(false);
  });

  test("clearing removes the keyword rather than writing false", () => {
    const doc: Record<string, unknown> = {};
    SchemaAccess.setRequiresAuth(doc, true);
    expect(doc).toEqual({ "x-silo-auth": true });
    SchemaAccess.setRequiresAuth(doc, false);
    expect(Object.hasOwn(doc, "x-silo-auth")).toBe(false);
  });

  test("the writer and the predicate agree", () => {
    const doc: Record<string, unknown> = {};
    SchemaAccess.setRequiresAuth(doc, true);
    expect(SchemaAccess.requiresAuth(doc)).toBe(true);
    SchemaAccess.setRequiresAuth(doc, false);
    expect(SchemaAccess.requiresAuth(doc)).toBe(false);
  });
});

describe("media field", () => {
  test("detects the media marker", () => {
    expect(MediaField.is({ type: "string", "x-silo-type": "media" })).toBe(true);
    expect(MediaField.is({ type: "string", "x-silo-type": "other" })).toBe(false);
    expect(MediaField.is({ type: "string" })).toBe(false);
    expect(MediaField.is(null)).toBe(false);
    expect(MediaField.is("x-silo-type")).toBe(false);
  });
});
