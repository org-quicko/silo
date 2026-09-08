import { describe, expect, test } from "bun:test";
import { VariableName } from "../src/variables/variable-name";
import { VariableTemplate } from "../src/variables/variable-template";

describe("VariableName", () => {
  test("accepts UPPER_SNAKE, camelCase and a leading underscore", () => {
    expect(VariableName.isValid("API_URL")).toBe(true);
    expect(VariableName.isValid("apiUrl")).toBe(true);
    expect(VariableName.isValid("_internal")).toBe(true);
    expect(VariableName.isValid("A1")).toBe(true);
  });

  test("refuses a leading digit, a dash, spaces and 65 characters", () => {
    expect(VariableName.isValid("9LIVES")).toBe(false);
    expect(VariableName.isValid("api-url")).toBe(false);
    expect(VariableName.isValid("api url")).toBe(false);
    expect(VariableName.isValid("A".repeat(65))).toBe(false);
    expect(VariableName.isValid("A".repeat(64))).toBe(true);
  });

  test("refuses a non-string without coercing it", () => {
    expect(VariableName.isValid(42)).toBe(false);
    expect(VariableName.isValid(null)).toBe(false);
    expect(() => VariableName.assert(42)).toThrow(/invalid variable name/);
  });
});

describe("VariableTemplate.references", () => {
  test("finds each reference with its bounds", () => {
    expect(VariableTemplate.references("a {{X}} b {{Y}}")).toEqual([
      { name: "X", start: 2, end: 7 },
      { name: "Y", start: 10, end: 15 },
    ]);
  });

  test("trims inner whitespace", () => {
    expect(VariableTemplate.names("{{  API_URL  }}")).toEqual(["API_URL"]);
  });

  test("ignores text that is not a well-formed name", () => {
    expect(VariableTemplate.names("{{}} {{ }} {{a b}} {{9x}} {{api-url}}")).toEqual([]);
  });

  test("names deduplicates while references does not", () => {
    expect(VariableTemplate.references("{{X}}{{X}}").length).toBe(2);
    expect(VariableTemplate.names("{{X}}{{X}}")).toEqual(["X"]);
  });

  test("a shared regex does not carry lastIndex between calls", () => {
    expect(VariableTemplate.has("{{X}}")).toBe(true);
    expect(VariableTemplate.has("{{X}}")).toBe(true);
    expect(VariableTemplate.names("{{X}}")).toEqual(["X"]);
    expect(VariableTemplate.names("{{X}}")).toEqual(["X"]);
  });
});

describe("VariableTemplate.render", () => {
  const values: Record<string, string> = { API_URL: "https://api.example.com", EMPTY: "" };
  const lookup = (name: string) => values[name];

  test("substitutes what it can and leaves the rest spelled", () => {
    expect(VariableTemplate.render("{{API_URL}}/v1 and {{UNKNOWN}}", lookup)).toBe(
      "https://api.example.com/v1 and {{UNKNOWN}}",
    );
  });

  test("an empty value substitutes as empty, not as unresolved", () => {
    expect(VariableTemplate.render("[{{EMPTY}}]", lookup)).toBe("[]");
  });

  test("replaces every occurrence, not only the first", () => {
    expect(VariableTemplate.render("{{EMPTY}}{{EMPTY}}x", lookup)).toBe("x");
  });

  test("a value containing a template is inserted as text and never re-scanned", () => {
    const nested = (name: string) => (name === "A" ? "{{B}}" : name === "B" ? "boom" : undefined);
    expect(VariableTemplate.render("{{A}}", nested)).toBe("{{B}}");
  });

  test("a value's own $-sequences are literal, not replacement patterns", () => {
    const dollars = () => "$& $1 $$";
    expect(VariableTemplate.render("{{X}}", dollars)).toBe("$& $1 $$");
  });

  test("text with no reference is returned unchanged", () => {
    expect(VariableTemplate.render("plain", lookup)).toBe("plain");
    expect(VariableTemplate.render("{ not a brace pair }", lookup)).toBe("{ not a brace pair }");
  });
});
