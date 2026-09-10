import { describe, expect, test } from "bun:test";
import { Filter } from "../../src/query/filter";

describe("Filter: paths", () => {
  test("field, each and meta build on the right FieldPath prefix", () => {
    expect(Filter.field("status").equals("x").toJSON().path).toBe("$.data.status");
    expect(Filter.each("tags").equals("x").toJSON().path).toBe("$.data.tags[*]");
    expect(Filter.meta("updated_at").equals("x").toJSON().path).toBe("$.updated_at");
  });
});

describe("Filter: every leaf operator", () => {
  test("equals -> eq", () => {
    expect(Filter.field("status").equals("published").toJSON()).toEqual({
      op: "eq",
      path: "$.data.status",
      value: "published",
    });
  });

  test("notEquals -> neq", () => {
    expect(Filter.field("status").notEquals("draft").toJSON()).toEqual({
      op: "neq",
      path: "$.data.status",
      value: "draft",
    });
  });

  test("contains -> contains", () => {
    expect(Filter.field("title").contains("ada").toJSON()).toEqual({
      op: "contains",
      path: "$.data.title",
      value: "ada",
    });
  });

  test("greaterThan -> gt", () => {
    expect(Filter.field("views").greaterThan(10).toJSON()).toEqual({ op: "gt", path: "$.data.views", value: 10 });
  });

  test("atLeast -> gte", () => {
    expect(Filter.field("views").atLeast(10).toJSON()).toEqual({ op: "gte", path: "$.data.views", value: 10 });
  });

  test("lessThan -> lt", () => {
    expect(Filter.field("views").lessThan(10).toJSON()).toEqual({ op: "lt", path: "$.data.views", value: 10 });
  });

  test("atMost -> lte", () => {
    expect(Filter.field("views").atMost(10).toJSON()).toEqual({ op: "lte", path: "$.data.views", value: 10 });
  });

  test("oneOf -> in", () => {
    expect(Filter.field("status").oneOf(["draft", "review"]).toJSON()).toEqual({
      op: "in",
      path: "$.data.status",
      value: ["draft", "review"],
    });
  });

  test("exists -> exists, with no value", () => {
    expect(Filter.field("subtitle").exists().toJSON()).toEqual({ op: "exists", path: "$.data.subtitle" });
  });
});

describe("Filter: groups", () => {
  test("and", () => {
    const node = Filter.and(Filter.field("a").equals(1), Filter.field("b").equals(2)).toJSON();
    expect(node.op).toBe("and");
    expect(node.args).toHaveLength(2);
  });

  test("or", () => {
    const node = Filter.or(Filter.field("a").equals(1), Filter.field("b").equals(2)).toJSON();
    expect(node.op).toBe("or");
  });

  test("not", () => {
    const node = Filter.not(Filter.each("tags").equals("x")).toJSON();
    expect(node).toEqual({ op: "not", args: [{ op: "eq", path: "$.data.tags[*]", value: "x" }] });
  });

  test("the some/none subtlety: neq on each versus not(eq(each))", () => {
    const some = Filter.each("tags").notEquals("x").toJSON();
    const none = Filter.not(Filter.each("tags").equals("x")).toJSON();
    expect(some).toEqual({ op: "neq", path: "$.data.tags[*]", value: "x" });
    expect(none).toEqual({ op: "not", args: [{ op: "eq", path: "$.data.tags[*]", value: "x" }] });
  });
});

describe("Filter.raw", () => {
  test("wraps a hand-built node exactly as given", () => {
    const node = { op: "eq" as const, path: "$.data.status", value: "published" };
    expect(Filter.raw(node).toJSON()).toBe(node);
  });
});
