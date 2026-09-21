import { describe, expect, test } from "bun:test";
import { SchemaShape } from "../src/schema/schema-shape";

/** The validating projection that decides whether a schema may change while a
 *  collection holds entries (D70). */
describe("schema shape", () => {
  const posts = {
    type: "object",
    title: "Posts",
    properties: { title: { type: "string" } },
    required: ["title"],
  };

  test("a document is the same shape as itself", () => {
    expect(SchemaShape.same(posts, structuredClone(posts))).toBe(true);
  });

  test("key order is not a change", () => {
    expect(
      SchemaShape.same(
        { type: "object", properties: { a: { type: "string" }, b: { type: "number" } } },
        { properties: { b: { type: "number" }, a: { type: "string" } }, type: "object" }
      )
    ).toBe(true);
  });

  test("access, search, and labels are not constraints", () => {
    const configured = {
      ...posts,
      title: "Articles",
      description: "now with a description",
      $comment: "and a note",
      "x-silo-auth": true,
      "x-silo-search": { label: ["$.data.title"], exclude: [] },
    };
    expect(SchemaShape.same(posts, configured)).toBe(true);
  });

  test("annotations nested in a property are not constraints either", () => {
    const labelled = {
      type: "object",
      properties: { title: { type: "string", title: "Headline", description: "the big one" } },
    };
    expect(SchemaShape.same({ type: "object", properties: { title: { type: "string" } } }, labelled)).toBe(
      true
    );
  });

  test("adding, removing or retyping a field is a change", () => {
    expect(SchemaShape.same(posts, { ...posts, properties: {} })).toBe(false);
    expect(
      SchemaShape.same(posts, {
        ...posts,
        properties: { title: { type: "string" }, body: { type: "string" } },
      })
    ).toBe(false);
    expect(
      SchemaShape.same(posts, { ...posts, properties: { title: { type: "number" } } })
    ).toBe(false);
  });

  test("a new required field is a change even though the properties match", () => {
    expect(SchemaShape.same(posts, { ...posts, required: [] })).toBe(false);
  });

  test("a bundled $defs counts, because the validator compiles it", () => {
    const withRef = { type: "object", properties: { author: { $ref: "silo://collections/authors" } } };
    expect(
      SchemaShape.same(
        { ...withRef, $defs: { authors: { type: "object", properties: { name: { type: "string" } } } } },
        { ...withRef, $defs: { authors: { type: "object", properties: { name: { type: "number" } } } } }
      )
    ).toBe(false);
  });

  test("a property genuinely named title inside literal data survives the strip", () => {
    // `enum`, `const`, `default` and `examples` hold values, not subschemas —
    // stripping inside them would make two different enums compare equal.
    const one = { type: "object", properties: { pick: { enum: [{ title: "a" }] } } };
    const two = { type: "object", properties: { pick: { enum: [{ title: "b" }] } } };
    expect(SchemaShape.same(one, two)).toBe(false);

    const withDefault = { type: "object", default: { title: "draft" } };
    expect(SchemaShape.same(withDefault, { type: "object", default: { title: "live" } })).toBe(false);
  });

  test("a field named title is a field, not a label", () => {
    // The trap the walk exists to avoid: strip by key name alone and a
    // collection whose field is called `title` has that field outside the
    // frozen shape entirely.
    const named = { type: "object", properties: { title: { type: "string" } } };
    expect(SchemaShape.same(named, { type: "object", properties: {} })).toBe(false);
    expect(
      SchemaShape.same(named, { type: "object", properties: { title: { type: "number" } } })
    ).toBe(false);

    for (const field of SchemaShape.Annotations) {
      expect(
        SchemaShape.same(
          { type: "object", properties: { [field]: { type: "string" } } },
          { type: "object", properties: { [field]: { type: "number" } } }
        )
      ).toBe(false);
    }
  });

  test("a $defs entry named after an annotation is still compared", () => {
    expect(
      SchemaShape.same(
        { $defs: { description: { type: "string" } } },
        { $defs: { description: { type: "number" } } }
      )
    ).toBe(false);
  });

  test("a keyword nobody classified is frozen rather than ignored", () => {
    expect(
      SchemaShape.same({ type: "object", "x-silo-unknown": 1 }, { type: "object", "x-silo-unknown": 2 })
    ).toBe(false);
  });

  test("declaring the dialect the validator already uses is not a change", () => {
    // The admin's visual builder writes `$schema` on every save. A schema
    // created over the API without one would otherwise be refused on its first
    // edit, for a keyword the author never typed and that silo does not read:
    // every collection compiles under Ajv2020 whatever this says.
    expect(
      SchemaShape.same(posts, { ...posts, $schema: "https://json-schema.org/draft/2020-12/schema" })
    ).toBe(true);
  });

  test("the annotation list is the whole difference between the two kinds", () => {
    expect([...SchemaShape.Annotations].sort()).toEqual([
      "$comment",
      "$schema",
      "description",
      "title",
      "x-silo-auth",
      "x-silo-search",
    ]);
  });
});
