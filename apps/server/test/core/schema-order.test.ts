import { describe, expect, test } from "bun:test";
import { SchemaOrder } from "../../src/core/schema/schema-order";

/** Keys at every depth, so a test states the whole order it expects. */
const shape = (value: any): any => {
  if (Array.isArray(value)) return value.map(shape);
  if (value === null || typeof value !== "object") return value;
  return Object.keys(value).map((key) => [key, shape(value[key])]);
};

describe("SchemaOrder (D93)", () => {
  test("declared fields in schema order, then the rest in codepoint order", () => {
    const schema = { type: "object", properties: { title: {}, body: {}, views: {} } };
    const ordered = SchemaOrder.apply({ zeta: 1, views: 3, Beta: 2, body: "b", alpha: 0, title: "t" }, schema);
    expect(Object.keys(ordered)).toEqual(["title", "body", "views", "Beta", "alpha", "zeta"]);
    expect(ordered).toEqual({ zeta: 1, views: 3, Beta: 2, body: "b", alpha: 0, title: "t" });
  });

  test("no schema, or a schema with no properties, orders every key by codepoint", () => {
    const data = { b: 1, a: { d: 1, c: 2 }, B: 3 };
    expect(shape(SchemaOrder.apply(data))).toEqual([["B", 3], ["a", [["c", 2], ["d", 1]]], ["b", 1]]);
    expect(shape(SchemaOrder.apply(data, { "x-silo-system": true }))).toEqual(
      shape(SchemaOrder.apply(data))
    );
  });

  test("orders nested objects, array items and tuple positions", () => {
    const schema = {
      type: "object",
      properties: {
        author: { type: "object", properties: { name: {}, email: {} } },
        blocks: { type: "array", items: { type: "object", properties: { kind: {}, text: {} } } },
        pair: { type: "array", prefixItems: [{ properties: { x: {}, y: {} } }, { properties: { b: {}, a: {} } }] },
      },
    };
    const ordered = SchemaOrder.apply(
      {
        pair: [{ y: 1, x: 2 }, { a: 1, b: 2 }],
        blocks: [{ text: "t", kind: "para" }, { extra: 1, kind: "quote" }],
        author: { email: "e", name: "n" },
      },
      schema
    );
    expect(shape(ordered)).toEqual([
      ["author", [["name", "n"], ["email", "e"]]],
      ["blocks", [[["kind", "para"], ["text", "t"]], [["kind", "quote"], ["extra", 1]]]],
      ["pair", [[["x", 2], ["y", 1]], [["b", 2], ["a", 1]]]],
    ]);
    // Element order is data, never reordered.
    expect(SchemaOrder.apply({ tags: ["b", "a"] }, schema).tags).toEqual(["b", "a"]);
  });

  test("follows $ref: a local pointer, and a bundled collection or remote ref", () => {
    const schema = {
      type: "object",
      properties: {
        local: { $ref: "#/$defs/person" },
        linked: { $ref: "silo://collections/authors" },
        remote: { $ref: "https://example.com/address.json" },
      },
      $defs: {
        person: { properties: { name: {}, age: {} } },
        authors: { properties: { handle: {}, bio: {} } },
        "https://example.com/address.json": { properties: { street: {}, city: {} } },
      },
    };
    const ordered = SchemaOrder.apply(
      {
        remote: { city: "c", street: "s" },
        linked: { bio: "b", handle: "h" },
        local: { age: 1, name: "n" },
      },
      schema
    );
    expect(shape(ordered)).toEqual([
      ["local", [["name", "n"], ["age", 1]]],
      ["linked", [["handle", "h"], ["bio", "b"]]],
      ["remote", [["street", "s"], ["city", "c"]]],
    ]);
  });

  test("gathers declarations from allOf, anyOf, oneOf, then and else, first one winning", () => {
    const schema = {
      allOf: [{ properties: { first: {} } }, { $ref: "#/$defs/more" }],
      oneOf: [{ properties: { choice: { properties: { z: {}, y: {} } } } }],
      if: { properties: { kind: { const: "x" } } },
      then: { properties: { onlyIfX: {} } },
      $defs: { more: { properties: { second: {}, first: { properties: { never: {} } } } } },
    };
    const ordered = SchemaOrder.apply(
      { onlyIfX: 1, choice: { y: 1, z: 2 }, second: 2, first: { b: 1, a: 2 }, other: 0 },
      schema
    );
    expect(shape(ordered)).toEqual([
      ["first", [["a", 2], ["b", 1]]],
      ["second", 2],
      ["choice", [["z", 2], ["y", 1]]],
      ["onlyIfX", 1],
      ["other", 0],
    ]);
  });

  test("an undeclared key takes patternProperties, then additionalProperties, for its value's order", () => {
    const schema = {
      type: "object",
      properties: { title: {} },
      patternProperties: { "^x-": { properties: { second: {}, first: {} } } },
      additionalProperties: { properties: { en: {}, fr: {} } },
    };
    const ordered = SchemaOrder.apply(
      { "x-meta": { first: 1, second: 2 }, labels: { fr: "f", en: "e" }, title: "t" },
      schema
    );
    expect(shape(ordered)).toEqual([
      ["title", "t"],
      ["labels", [["en", "e"], ["fr", "f"]]],
      ["x-meta", [["second", 2], ["first", 1]]],
    ]);
  });

  test("survives cyclic refs, unresolved refs, bad patterns and a __proto__ key", () => {
    const cyclic = { $ref: "#/$defs/loop", $defs: { loop: { $ref: "#/$defs/loop" } } };
    expect(Object.keys(SchemaOrder.apply({ b: 1, a: 2 }, cyclic))).toEqual(["a", "b"]);
    expect(Object.keys(SchemaOrder.apply({ b: 1, a: 2 }, { $ref: "#/$defs/missing" }))).toEqual(["a", "b"]);
    expect(Object.keys(SchemaOrder.apply({ b: 1, a: 2 }, { patternProperties: { "(": {} } }))).toEqual([
      "a",
      "b",
    ]);

    const tree = { properties: { name: {}, children: { type: "array", items: { $ref: "#" } } } };
    const nested = SchemaOrder.apply(
      { children: [{ children: [], name: "leaf" }], name: "root" },
      tree
    );
    expect(shape(nested)).toEqual([
      ["name", "root"],
      ["children", [[["name", "leaf"], ["children", []]]]],
    ]);

    const withProto = SchemaOrder.apply(JSON.parse('{"b": 1, "__proto__": {"x": 1}}'));
    expect(Object.keys(withProto)).toEqual(["__proto__", "b"]);
    expect(Object.getPrototypeOf(withProto)).toBe(Object.prototype);
  });

  test("leaves scalars, null and a non-object schema alone", () => {
    expect(SchemaOrder.apply("text", { properties: {} })).toBe("text");
    expect(SchemaOrder.apply(null)).toBeNull();
    expect(Object.keys(SchemaOrder.apply({ b: 1, a: 2 }, true))).toEqual(["a", "b"]);
  });
});
