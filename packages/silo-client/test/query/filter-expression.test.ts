import { describe, expect, test } from "bun:test";
import { Filter } from "../../src/query/filter";

describe("FilterExpression", () => {
  test("toJSON answers the wire node", () => {
    expect(Filter.field("status").equals("published").toJSON()).toEqual({
      op: "eq",
      path: "$.data.status",
      value: "published",
    });
  });

  test("and combines two expressions into one and-node", () => {
    const combined = Filter.field("status").equals("published").and(Filter.field("title").contains("ada"));
    expect(combined.toJSON()).toEqual({
      op: "and",
      args: [
        { op: "eq", path: "$.data.status", value: "published" },
        { op: "contains", path: "$.data.title", value: "ada" },
      ],
    });
  });

  test("or combines two expressions into one or-node", () => {
    const combined = Filter.field("status").equals("draft").or(Filter.field("status").equals("review"));
    expect(combined.toJSON()).toEqual({
      op: "or",
      args: [
        { op: "eq", path: "$.data.status", value: "draft" },
        { op: "eq", path: "$.data.status", value: "review" },
      ],
    });
  });

  test("not wraps the expression it is called on", () => {
    const negated = Filter.each("tags").equals("draft").not();
    expect(negated.toJSON()).toEqual({
      op: "not",
      args: [{ op: "eq", path: "$.data.tags[*]", value: "draft" }],
    });
  });

  test("chains fluently: left.and(right).or(other)", () => {
    const left = Filter.field("status").equals("published");
    const right = Filter.each("tags").equals("release");
    const other = Filter.field("title").contains("ada");

    expect(left.and(right).or(other).toJSON()).toEqual({
      op: "or",
      args: [
        {
          op: "and",
          args: [
            { op: "eq", path: "$.data.status", value: "published" },
            { op: "eq", path: "$.data.tags[*]", value: "release" },
          ],
        },
        { op: "contains", path: "$.data.title", value: "ada" },
      ],
    });
  });
});
