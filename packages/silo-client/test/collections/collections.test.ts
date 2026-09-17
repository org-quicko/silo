import { describe, expect, test } from "bun:test";
import { Collections } from "../../src/collections/collections";
import { ValidationFailedError } from "../../src/errors/validation-failed-error";
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

  test("a schema declaring a reserved field name is refused by the server, not warned about here", async () => {
    const stubFetch = new StubFetch();
    const schema = { type: "object", properties: { title: { type: "string" }, created_at: { type: "string" } } };
    stubFetch.enqueue(
      StubResponse.errorBody(
        400,
        "validation_failed",
        'collection "posts" declares reserved field "created_at"',
        [{ path: "/properties/created_at", message: "reserved field name" }],
      ),
    );

    const attempt = new Collections(scopeOf(stubFetch)).create("posts", schema);

    // The client sends it and reports what came back: silo owns this rule now,
    // so there is no local list here to drift from it (D62).
    const error = await attempt.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ValidationFailedError);
    expect((error as ValidationFailedError).message).toContain("created_at");
    expect((error as ValidationFailedError).details).toEqual([
      { path: "/properties/created_at", message: "reserved field name" },
    ]);
  });
});
