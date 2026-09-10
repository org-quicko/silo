import { describe, expect, test } from "bun:test";
import { EntryMapper } from "../../src/entries/entry-mapper";
import type { EntryPayload } from "../../src/entries/entry-payload";

describe("EntryMapper.fieldsOf", () => {
  test("strips only the four envelope keys, never a content field name", () => {
    const payload: EntryPayload = {
      id: "01J8",
      rev: 3,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-02T00:00:00.000Z",
      title: "Hello",
      product_code: "SKU-1",
      url: "{{API_URL}}/posts",
    };

    const fields = EntryMapper.fieldsOf<Record<string, unknown>>(payload);

    expect(fields).toEqual({ title: "Hello", product_code: "SKU-1", url: "{{API_URL}}/posts" });
  });

  test("a field literally named like a JSON Schema keyword survives untouched", () => {
    const payload: EntryPayload = {
      id: "01J8",
      rev: 1,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      properties: "not a schema, just a field called properties",
    };

    expect(EntryMapper.fieldsOf<Record<string, unknown>>(payload)).toEqual({
      properties: "not a schema, just a field called properties",
    });
  });
});

describe("EntryMapper.toPayload", () => {
  test("rebuilds the flat wire shape around the given fields", () => {
    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    const updatedAt = new Date("2026-01-02T00:00:00.000Z");

    const payload = EntryMapper.toPayload("01J8", 4, { title: "Hello", url: "{{API_URL}}" }, createdAt, updatedAt);

    expect(payload).toEqual({
      id: "01J8",
      rev: 4,
      title: "Hello",
      url: "{{API_URL}}",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-02T00:00:00.000Z",
    });
  });
});
