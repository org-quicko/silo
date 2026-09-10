import { describe, expect, test } from "bun:test";
import { ReservedFieldNames } from "../../src/collections/reserved-field-names";

describe("ReservedFieldNames", () => {
  test("names exactly the five keys EntryUtils.toApiResponse strips", () => {
    expect([...ReservedFieldNames.all].sort()).toEqual(
      ["created_at", "id", "rev", "seq", "updated_at"].sort(),
    );
  });

  test("isReserved is true only for those five", () => {
    expect(ReservedFieldNames.isReserved("rev")).toBe(true);
    expect(ReservedFieldNames.isReserved("title")).toBe(false);
    expect(ReservedFieldNames.isReserved("product_code")).toBe(false);
  });
});
