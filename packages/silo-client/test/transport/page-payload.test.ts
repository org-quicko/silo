import { describe, expect, test } from "bun:test";
import { PagePayload } from "../../src/transport/page-payload";

describe("PagePayload", () => {
  test("reads rows under data, entries' and search's key", () => {
    const result = PagePayload.read<{ id: string }>({
      data: [{ id: "1" }, { id: "2" }],
      total: 2,
      limit: 50,
      offset: 0,
    });

    expect(result.rows).toEqual([{ id: "1" }, { id: "2" }]);
    expect(result.total).toBe(2);
    expect(result.limit).toBe(50);
    expect(result.offset).toBe(0);
  });

  test("reads rows under items, media's, collections' and projects' key", () => {
    const result = PagePayload.read<{ id: string }>({
      items: [{ id: "a" }],
      total: 1,
    });

    expect(result.rows).toEqual([{ id: "a" }]);
    expect(result.total).toBe(1);
    expect(result.limit).toBeUndefined();
    expect(result.offset).toBeUndefined();
  });

  test("falls back to the row count when total is absent", () => {
    const result = PagePayload.read<{ id: string }>({ items: [{ id: "a" }, { id: "b" }] });
    expect(result.total).toBe(2);
  });

  test("answers no rows when neither key is present", () => {
    const result = PagePayload.read({});
    expect(result.rows).toEqual([]);
    expect(result.total).toBe(0);
  });
});
