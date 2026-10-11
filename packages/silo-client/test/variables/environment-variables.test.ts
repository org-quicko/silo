import { describe, expect, test } from "bun:test";
import { ScopeReference } from "../../src/scope/scope-reference";
import { Transport } from "../../src/transport/transport";
import { EnvironmentVariables } from "../../src/variables/environment-variables";
import { StubFetch } from "../support/stub-fetch";
import { StubResponse } from "../support/stub-response";

const scopeOf = (stubFetch: StubFetch): ScopeReference =>
  new ScopeReference(new Transport({ url: "http://localhost:8090", fetch: stubFetch.fetch }), "acme", "prod");

const declarationOf = (overrides: Record<string, unknown> = {}) => ({
  name: "API_URL",
  description: "",
  value: "https://api.acme.com",
  set_in: 1,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

describe("EnvironmentVariables", () => {
  test("list() GETs this environment's declared values", async () => {
    const stubFetch = new StubFetch();
    stubFetch.enqueue(StubResponse.json({ items: [declarationOf()] }));

    const variables = await new EnvironmentVariables(scopeOf(stubFetch)).list();

    expect(stubFetch.received[0].url).toBe("http://localhost:8090/api/projects/acme/envs/prod/variables");
    expect(variables[0].name).toBe("API_URL");
  });

  test("set() PUTs {value} to the named variable", async () => {
    const stubFetch = new StubFetch();
    stubFetch.enqueue(StubResponse.json(declarationOf()));

    await new EnvironmentVariables(scopeOf(stubFetch)).set("API_URL", "https://api.acme.com");

    expect(stubFetch.received[0].method).toBe("PUT");
    expect(stubFetch.received[0].url).toBe(
      "http://localhost:8090/api/projects/acme/envs/prod/variables/API_URL",
    );
    expect(JSON.parse(stubFetch.received[0].body ?? "{}")).toEqual({ value: "https://api.acme.com" });
  });

  test("unset() DELETEs, and answers the updated declaration rather than nothing", async () => {
    const stubFetch = new StubFetch();
    stubFetch.enqueue(StubResponse.json(declarationOf({ value: null, set_in: 0 })));

    const variable = await new EnvironmentVariables(scopeOf(stubFetch)).unset("API_URL");

    expect(stubFetch.received[0].method).toBe("DELETE");
    expect(variable.value).toBeNull();
  });
});
