import { describe, expect, test } from "bun:test";
import { FieldPath } from "../../src/query/field-path";

describe("FieldPath", () => {
  test("field prefixes $.data.", () => {
    expect(FieldPath.field("status")).toBe("$.data.status");
  });

  test("field passes a dotted nested name through untouched", () => {
    expect(FieldPath.field("author.name")).toBe("$.data.author.name");
  });

  test("field passes a bracket segment through untouched, including a negative index", () => {
    expect(FieldPath.field("tags[0]")).toBe("$.data.tags[0]");
    expect(FieldPath.field("tags[-1]")).toBe("$.data.tags[-1]");
  });

  test("each appends the [*] wildcard", () => {
    expect(FieldPath.each("tags")).toBe("$.data.tags[*]");
  });

  test("meta addresses the envelope, not data", () => {
    expect(FieldPath.meta("updated_at")).toBe("$.updated_at");
  });
});
