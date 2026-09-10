import { describe, expect, test } from "bun:test";
import { TypedFilter } from "../../src/query/typed-filter";

interface Post {
  title: string;
  status: "draft" | "published";
  tags: string[];
  views: number;
}

describe("TypedFilter: runtime shape matches the untyped Filter", () => {
  const filter = new TypedFilter<Post>();

  test("field", () => {
    expect(filter.field("status").equals("published").toJSON()).toEqual({
      op: "eq",
      path: "$.data.status",
      value: "published",
    });
  });

  test("each appends the wildcard", () => {
    expect(filter.each("tags").equals("release").toJSON()).toEqual({
      op: "eq",
      path: "$.data.tags[*]",
      value: "release",
    });
  });

  test("a dotted extension of a plain field still resolves, at $.data", () => {
    expect(filter.field("title.raw").equals("x").toJSON().path).toBe("$.data.title.raw");
  });

  test("a bracketed extension of a plain field still resolves, at $.data", () => {
    expect(filter.field("tags[0]").equals("x").toJSON().path).toBe("$.data.tags[0]");
  });

  test("meta, and, or, not and raw behave like the untyped statics", () => {
    expect(filter.meta("updated_at").equals("2026-01-01").toJSON().path).toBe("$.updated_at");

    const negated = filter.not(filter.field("status").equals("draft"));
    expect(negated.toJSON()).toEqual({ op: "not", args: [{ op: "eq", path: "$.data.status", value: "draft" }] });

    const raw = filter.raw({ op: "eq", path: "$.data.custom", value: 1 });
    expect(raw.toJSON()).toEqual({ op: "eq", path: "$.data.custom", value: 1 });
  });
});

describe("TypedFilter, checked at compile time", () => {
  const filter = new TypedFilter<Post>();

  test("a misspelled field does not compile", () => {
    // @ts-expect-error "stauts" is not a key of Post, nor an extension of one.
    filter.field("stauts");
  });

  test("a value of the wrong type for the field does not compile", () => {
    // @ts-expect-error status is "draft" | "published", not a number.
    filter.field("status").equals(3);
    // @ts-expect-error views is a number, not a string.
    filter.field("views").greaterThan("ten");
  });

  test("this file only asserts the two cases above compile as expected", () => {
    expect(true).toBe(true);
  });
});
