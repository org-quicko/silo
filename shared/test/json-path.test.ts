import { describe, expect, test } from "bun:test";
import { JsonPath } from "../src/query/path/json-path";
import { ValidationError } from "../src/errors/validation-error";

const parse = (raw: string) => JsonPath.parse(raw);
const reason = (raw: string): string => {
  try {
    JsonPath.parse(raw);
    throw new Error(`expected "${raw}" to be refused`);
  } catch (err) {
    if (!ValidationError.is(err)) throw err;
    return err.message;
  }
};

describe("the accepted subset", () => {
  test("envelope fields carry no further selectors", () => {
    for (const f of JsonPath.EnvelopeFields) {
      const p = parse(`$.${f}`);
      expect(p.root).toBe(f);
      expect(p.isEnvelope).toBe(true);
      expect(p.singular).toBe(true);
      expect(p.selectors).toEqual([]);
    }
  });

  test("name selectors nest under data", () => {
    const p = parse("$.data.author.name");
    expect(p.root).toBe("data");
    expect(p.isEnvelope).toBe(false);
    expect(p.singular).toBe(true);
    expect(p.selectors).toEqual([
      { kind: "name", name: "author" },
      { kind: "name", name: "name" },
    ]);
  });

  test("array indexes, negative included", () => {
    expect(parse("$.data.items[0]").selectors).toEqual([
      { kind: "name", name: "items" },
      { kind: "index", index: 0 },
    ]);
    expect(parse("$.data.items[-1]").selectors).toEqual([
      { kind: "name", name: "items" },
      { kind: "index", index: -1 },
    ]);
  });

  test("both wildcard spellings are the same selector", () => {
    const bracket = parse("$.data.tags[*]");
    const dot = parse("$.data.tags.*");
    expect(bracket.selectors).toEqual(dot.selectors);
    expect(bracket.singular).toBe(false);
    expect(dot.singular).toBe(false);
  });

  test("quoted names carry what shorthand cannot", () => {
    expect(parse("$.data['a b'].c").selectors).toEqual([
      { kind: "name", name: "a b" },
      { kind: "name", name: "c" },
    ]);
    expect(parse('$.data["dash-ed"]').selectors).toEqual([{ kind: "name", name: "dash-ed" }]);
    expect(parse("$.data['it\\'s']").selectors).toEqual([{ kind: "name", name: "it's" }]);
  });

  test("a non-ASCII shorthand name is a name, not an error", () => {
    expect(parse("$.data.título").selectors).toEqual([{ kind: "name", name: "título" }]);
  });

  test("a wildcard anywhere makes the path non-singular", () => {
    expect(parse("$.data.a[*].b").singular).toBe(false);
    expect(parse("$.data.a[0].b").singular).toBe(true);
  });
});

// Every one of these must be refused *by name*. A selector that parses and is
// then quietly dropped answers a different question and returns a wrong
// result, which no test written with well-formed paths would catch (D29).
describe("selectors outside the subset are refused by name", () => {
  test("recursive descent", () => {
    expect(reason("$..title")).toContain("recursive-descent selectors");
    expect(reason("$.data..title")).toContain("recursive-descent selectors");
  });

  test("slices", () => {
    expect(reason("$.data.items[1:3]")).toContain("slice selectors");
  });

  test("index unions", () => {
    expect(reason("$.data.items[0,2]")).toContain("index-union selectors");
  });

  test("filter selectors", () => {
    expect(reason("$.data.items[?@.price<10]")).toContain("filter selectors");
  });

  test("function extensions", () => {
    expect(reason("$.data.length()")).toContain("function extensions");
  });
});

describe("the root is the virtual entry document", () => {
  test("storage-only fields are unaddressable, and say so", () => {
    for (const hidden of ["project", "env", "collection", "seq"]) {
      const msg = reason(`$.${hidden}`);
      expect(msg).toContain("is not part of the entry document");
      expect(msg).toContain("$.data");
    }
  });

  test("an envelope field is a scalar", () => {
    expect(reason("$.id[0]")).toContain("takes no further selectors");
    expect(reason("$.updated_at.year")).toContain("takes no further selectors");
  });

  test("a path must start at the root and address a field", () => {
    expect(reason("data.title")).toContain('must start at the root');
    expect(reason("$")).toContain("must address a field");
    expect(reason("$[0]")).toContain("must start with a field name");
    expect(reason("")).toContain("a path is required");
  });

  test("malformed brackets and stray characters are named", () => {
    expect(reason("$.data.items[0")).toContain('unclosed "["');
    expect(reason("$.data.items[x]")).toContain("is not an index");
    expect(reason("$.data.")).toContain("expected a field name");
    expect(reason("$.data!x")).toContain('unexpected "!"');
  });

  test("isValid mirrors parse without throwing", () => {
    expect(JsonPath.isValid("$.data.a[*]")).toBe(true);
    expect(JsonPath.isValid("$..a")).toBe(false);
  });
});
