import { describe, expect, test } from "bun:test";
import { Collections } from "../../src/collections/collections";
import { ScopeReference } from "../../src/scope/scope-reference";
import { Transport } from "../../src/transport/transport";
import { StubFetch } from "../support/stub-fetch";
import { StubResponse } from "../support/stub-response";

const scopeOf = (stubFetch: StubFetch): ScopeReference =>
  new ScopeReference(new Transport({ url: "http://localhost:8090", fetch: stubFetch.fetch }), "acme", "prod");

describe("Collections.list", () => {
  test("GETs the collection list and maps summaries, camel-casing only known metadata", async () => {
    const stubFetch = new StubFetch();
    stubFetch.enqueue(
      StubResponse.json({
        items: [
          {
            id: "01J8",
            name: "posts",
            entries: 12,
            requires_auth: true,
            created_at: "2026-01-01T00:00:00.000Z",
            updated_at: "2026-01-02T00:00:00.000Z",
          },
        ],
      }),
    );

    const summaries = await new Collections(scopeOf(stubFetch)).list();

    expect(stubFetch.received[0].method).toBe("GET");
    expect(stubFetch.received[0].url).toBe("http://localhost:8090/api/projects/acme/envs/prod/collections");
    expect(summaries).toEqual([
      {
        id: "01J8",
        name: "posts",
        entries: 12,
        requiresAuth: true,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-02T00:00:00.000Z"),
      },
    ]);
  });
});

describe("Collections.create", () => {
  test("POSTs {name, schema}, URL-encoding a collection name that needs it", async () => {
    const stubFetch = new StubFetch();
    const schema = { type: "object", properties: { title: { type: "string" } } };
    stubFetch.enqueue(StubResponse.json({ id: "01J8", name: "my posts", schema }, 201));

    const collection = await new Collections(scopeOf(stubFetch)).create("my posts", schema);

    expect(stubFetch.received[0].method).toBe("POST");
    expect(stubFetch.received[0].url).toBe("http://localhost:8090/api/projects/acme/envs/prod/collections");
    expect(JSON.parse(stubFetch.received[0].body ?? "{}")).toEqual({ name: "my posts", schema });
    expect(collection).toEqual({ id: "01J8", name: "my posts", schema });
  });

  test("warns, naming the field, when a schema declares a reserved field name", async () => {
    const stubFetch = new StubFetch();
    const schema = { type: "object", properties: { title: { type: "string" }, created_at: { type: "string" } } };
    stubFetch.enqueue(StubResponse.json({ id: "01J8", name: "posts", schema }, 201));

    const originalWarn = console.warn;
    const warnings: string[] = [];
    console.warn = (message?: unknown) => {
      warnings.push(String(message));
    };
    try {
      await new Collections(scopeOf(stubFetch)).create("posts", schema);
    } finally {
      console.warn = originalWarn;
    }

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("created_at");
  });

  test("does not warn for an ordinary schema", async () => {
    const stubFetch = new StubFetch();
    const schema = { type: "object", properties: { title: { type: "string" } } };
    stubFetch.enqueue(StubResponse.json({ id: "01J8", name: "posts", schema }, 201));

    const originalWarn = console.warn;
    const warnings: string[] = [];
    console.warn = (message?: unknown) => {
      warnings.push(String(message));
    };
    try {
      await new Collections(scopeOf(stubFetch)).create("posts", schema);
    } finally {
      console.warn = originalWarn;
    }

    expect(warnings).toHaveLength(0);
  });
});
