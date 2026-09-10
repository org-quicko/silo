import { describe, expect, test } from "bun:test";
import { Sort } from "../../src/query/sort";

describe("Sort", () => {
  test("by defaults to ascending", () => {
    expect(Sort.by("title").toString()).toBe("$.data.title");
  });

  test("by, descending", () => {
    expect(Sort.by("title").descending().toString()).toBe("-$.data.title");
  });

  test("meta, ascending", () => {
    expect(Sort.meta("created_at").ascending().toString()).toBe("$.created_at");
  });

  test("recentlyUpdated sorts on updated_at, descending", () => {
    expect(Sort.recentlyUpdated().toString()).toBe("-$.updated_at");
  });

  test("recentlyCreated sorts on created_at, descending, and is a different order than recentlyUpdated", () => {
    expect(Sort.recentlyCreated().toString()).toBe("-$.created_at");
    expect(Sort.recentlyCreated().toString()).not.toBe(Sort.recentlyUpdated().toString());
  });

  test("of joins terms with a comma", () => {
    expect(Sort.of(Sort.by("status"), Sort.recentlyUpdated())).toBe("$.data.status,-$.updated_at");
  });

  test("of with a single term", () => {
    expect(Sort.of(Sort.by("title"))).toBe("$.data.title");
  });

  test("of with no terms", () => {
    expect(Sort.of()).toBe("");
  });

  test("has no each: a sort path selects at most one node", () => {
    expect((Sort as unknown as { each?: unknown }).each).toBeUndefined();
  });
});
