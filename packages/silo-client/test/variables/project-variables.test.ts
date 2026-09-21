import { describe, expect, test } from "bun:test";
import { Transport } from "../../src/transport/transport";
import { ProjectVariables } from "../../src/variables/project-variables";
import { StubFetch } from "../support/stub-fetch";
import { StubResponse } from "../support/stub-response";

const variablesOf = (stubFetch: StubFetch): ProjectVariables =>
  new ProjectVariables(new Transport({ url: "http://localhost:8090", fetch: stubFetch.fetch }), "acme");

const declarationOf = (overrides: Record<string, unknown> = {}) => ({
  name: "API_URL",
  description: "Public API root",
  value: "https://api.acme.com",
  set_in: 1,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

describe("ProjectVariables.declare", () => {
  test("POSTs {name, description, value}, with ?env= only when given", async () => {
    const stubFetch = new StubFetch();
    stubFetch.enqueue(StubResponse.json(declarationOf(), 201));

    await variablesOf(stubFetch).declare("API_URL", {
      description: "Public API root",
      environment: "prod",
      value: "https://api.acme.com",
    });

    expect(stubFetch.received[0].method).toBe("POST");
    expect(stubFetch.received[0].url).toBe("http://localhost:8090/api/projects/acme/variables?env=prod");
    expect(JSON.parse(stubFetch.received[0].body ?? "{}")).toEqual({
      name: "API_URL",
      description: "Public API root",
      value: "https://api.acme.com",
    });
  });

  test("omits ?env= when no environment is given", async () => {
    const stubFetch = new StubFetch();
    stubFetch.enqueue(StubResponse.json(declarationOf({ value: null, set_in: 0 }), 201));

    await variablesOf(stubFetch).declare("API_URL");

    expect(stubFetch.received[0].url).toBe("http://localhost:8090/api/projects/acme/variables");
  });
});

describe("ProjectVariables.rename / describe / undeclare", () => {
  test("rename() PATCHes {name: to}, and never rewrites the variable's own name as metadata", async () => {
    const stubFetch = new StubFetch();
    stubFetch.enqueue(StubResponse.json(declarationOf({ name: "PUBLIC_API_URL" })));

    const variable = await variablesOf(stubFetch).rename("API_URL", "PUBLIC_API_URL");

    expect(stubFetch.received[0].method).toBe("PATCH");
    expect(stubFetch.received[0].url).toBe("http://localhost:8090/api/projects/acme/variables/API_URL");
    expect(JSON.parse(stubFetch.received[0].body ?? "{}")).toEqual({ name: "PUBLIC_API_URL" });
    expect(variable.name).toBe("PUBLIC_API_URL");
  });

  test("describe() PATCHes {description}", async () => {
    const stubFetch = new StubFetch();
    stubFetch.enqueue(StubResponse.json(declarationOf({ description: "The public API root" })));

    await variablesOf(stubFetch).describe("API_URL", "The public API root");

    expect(JSON.parse(stubFetch.received[0].body ?? "{}")).toEqual({ description: "The public API root" });
  });

  test("undeclare() DELETEs and answers nothing", async () => {
    const stubFetch = new StubFetch();
    stubFetch.enqueue(StubResponse.empty());

    await variablesOf(stubFetch).undeclare("API_URL");

    expect(stubFetch.received[0].method).toBe("DELETE");
    expect(stubFetch.received[0].url).toBe("http://localhost:8090/api/projects/acme/variables/API_URL");
  });

  test("an explicit environment reaches PATCH/DELETE as ?env=, for a project with no \"prod\"", async () => {
    const stubFetch = new StubFetch();
    stubFetch.enqueue(StubResponse.json(declarationOf()));
    stubFetch.enqueue(StubResponse.empty());

    await variablesOf(stubFetch).describe("API_URL", "x", { environment: "staging" });
    await variablesOf(stubFetch).undeclare("API_URL", { environment: "staging" });

    expect(new URL(stubFetch.received[0].url).searchParams.get("env")).toBe("staging");
    expect(new URL(stubFetch.received[1].url).searchParams.get("env")).toBe("staging");
  });
});
