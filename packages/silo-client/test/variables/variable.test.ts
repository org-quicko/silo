import { describe, expect, test } from "bun:test";
import { Variable } from "../../src/variables/variable";

describe("Variable.fromWire", () => {
  test("maps set_in/created_at/updated_at, and never rewrites the variable's own name", () => {
    const variable = Variable.fromWire({
      name: "API_URL",
      description: "Public API root",
      value: "https://api.acme.com",
      set_in: 2,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-02T00:00:00.000Z",
    });

    expect(variable.name).toBe("API_URL");
    expect(variable.setIn).toBe(2);
    expect(variable.createdAt).toEqual(new Date("2026-01-01T00:00:00.000Z"));
    expect(variable.updatedAt).toEqual(new Date("2026-01-02T00:00:00.000Z"));
  });

  test("value is null, not \"\", when this environment has set nothing", () => {
    const variable = Variable.fromWire({
      name: "UNSET_VAR",
      description: "",
      value: null,
      set_in: 0,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    });

    expect(variable.value).toBeNull();
  });
});
