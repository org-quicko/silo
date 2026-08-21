import { describe, expect, test } from "bun:test";
import { SearchText } from "../../core/search/search-text";
import { SearchFields } from "@silo/shared/search-fields";
import { ValidationError } from "@silo/shared/validation-error";

const data = {
  title: "Pricing",
  views: 42,
  draft: true,
  archived_at: null,
  cover: "silo://media/01J8XQ4Z8K9M2P3R5T7V9X1B3D",
  author: { name: "Nina", email: "nina@example.com" },
  blocks: [{ text: "first block" }, { text: "second block" }],
  internal: { note: "do not index this" },
};

const paths = (schema?: unknown) =>
  SearchText.extract(data, schema).fields.map((f) => f.path);
const body = (schema?: unknown) => SearchText.extract(data, schema).body;

describe("the default corpus", () => {
  test("every string and number leaf, addressed by a concrete path", () => {
    expect(paths()).toEqual([
      "$.data.title",
      "$.data.views",
      "$.data.author.name",
      "$.data.author.email",
      "$.data.blocks[0].text",
      "$.data.blocks[1].text",
      "$.data.internal.note",
    ]);
  });

  test("field names are never indexed", () => {
    // Otherwise a search for "title" returns every entry that has one.
    expect(body()).not.toContain("title");
    expect(body()).toContain("Pricing");
  });

  test("booleans, nulls and media references contribute nothing", () => {
    const text = body();
    expect(text).not.toContain("true");
    expect(text).not.toContain("null");
    // A media id is an identifier, not prose: indexing it would make every
    // entry embedding the same asset match a search for its ULID.
    expect(text).not.toContain("01J8XQ4Z8K9M2P3R5T7V9X1B3D");
  });

  test("with no keyword, nothing is weighted", () => {
    expect(SearchText.extract(data).label).toBe("");
  });

  test("the byte cap stops one field crowding out the rest", () => {
    const big = { a: "x".repeat(100), b: "y".repeat(100) };
    const out = SearchText.extract(big, undefined, 120);
    expect(out.body.length).toBeLessThanOrEqual(121);
  });
});

describe("x-silo-search", () => {
  test("label promotes a path to the weighted column", () => {
    const out = SearchText.extract(data, { "x-silo-search": { label: ["$.data.title"] } });
    expect(out.label).toBe("Pricing");
    expect(out.body).not.toContain("Pricing");
  });

  test("exclude removes a whole subtree, not just an exact node", () => {
    const out = paths({ "x-silo-search": { exclude: ["$.data.internal"] } });
    expect(out).not.toContain("$.data.internal.note");
    expect(out).toContain("$.data.title");
  });

  test("a wildcard path reaches inside an array of objects", () => {
    const out = paths({ "x-silo-search": { exclude: ["$.data.blocks[*].text"] } });
    expect(out).not.toContain("$.data.blocks[0].text");
    expect(out).not.toContain("$.data.blocks[1].text");
    expect(out).toContain("$.data.title");
  });

  test("include is an allow-list that replaces the default", () => {
    // Additive would mean nothing — the default is already everything.
    const out = paths({ "x-silo-search": { include: ["$.data.title", "$.data.author.name"] } });
    expect(out).toEqual(["$.data.title", "$.data.author.name"]);
  });

  test("exclude subtracts from include", () => {
    const out = paths({
      "x-silo-search": { include: ["$.data.author"], exclude: ["$.data.author.email"] },
    });
    expect(out).toEqual(["$.data.author.name"]);
  });
});

describe("keyword validation", () => {
  const bad = (schema: unknown): string => {
    try {
      SearchFields.validate(schema);
      throw new Error("expected a refusal");
    } catch (err) {
      if (!ValidationError.is(err)) throw err;
      return err.message;
    }
  };

  test("a mistyped path is refused when the schema is saved", () => {
    expect(bad({ "x-silo-search": { label: ["$..title"] } })).toContain(
      "recursive-descent selectors"
    );
    expect(bad({ "x-silo-search": { label: ["title"] } })).toContain("must start at the root");
  });

  test("an envelope path is refused with a reason", () => {
    expect(bad({ "x-silo-search": { label: ["$.id"] } })).toContain("addresses the envelope");
  });

  test("unknown settings and wrong shapes are named", () => {
    expect(bad({ "x-silo-search": { labels: ["$.data.title"] } })).toContain('no "labels" setting');
    expect(bad({ "x-silo-search": { label: "$.data.title" } })).toContain("array of paths");
    expect(bad({ "x-silo-search": [] })).toContain("must be an object");
  });

  test("an absent keyword is valid", () => {
    expect(() => SearchFields.validate({ type: "object" })).not.toThrow();
  });
});
