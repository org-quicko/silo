import { describe, expect, test } from "bun:test";
import { CollectionSchema } from "../../src/collections/collection-schema";
import { ScopeReference } from "../../src/scope/scope-reference";
import { Transport } from "../../src/transport/transport";
import { StubFetch } from "../support/stub-fetch";
import { StubResponse } from "../support/stub-response";

const scopeOf = (stubFetch: StubFetch): ScopeReference =>
  new ScopeReference(new Transport({ url: "http://localhost:8090", fetch: stubFetch.fetch }), "acme", "prod");

describe("CollectionSchema", () => {
  test("get() reads the bundled schema", async () => {
    const stubFetch = new StubFetch();
    const schema = { type: "object" };
    stubFetch.enqueue(StubResponse.json({ id: "01J8", name: "posts", schema }));

    const definition = await new CollectionSchema(scopeOf(stubFetch), "posts").get();

    expect(stubFetch.received[0].url).toBe(
      "http://localhost:8090/api/projects/acme/envs/prod/collections/posts/schema",
    );
    expect(definition.schema).toEqual(schema);
  });

  test("put() sends the schema as the whole body", async () => {
    const stubFetch = new StubFetch();
    const schema = { type: "object", properties: { title: { type: "string" } } };
    stubFetch.enqueue(StubResponse.json({ id: "01J8", name: "posts", schema }));

    await new CollectionSchema(scopeOf(stubFetch), "posts").put(schema);

    expect(stubFetch.received[0].method).toBe("PUT");
    expect(JSON.parse(stubFetch.received[0].body ?? "{}")).toEqual(schema);
  });

  test("delete() sends ?force=true only when asked, and needs no rev", async () => {
    const stubFetch = new StubFetch();
    stubFetch.enqueue(StubResponse.empty());
    stubFetch.enqueue(StubResponse.empty());

    await new CollectionSchema(scopeOf(stubFetch), "posts").delete();
    await new CollectionSchema(scopeOf(stubFetch), "posts").delete({ force: true });

    expect(stubFetch.received[0].url).toBe(
      "http://localhost:8090/api/projects/acme/envs/prod/collections/posts/schema",
    );
    expect(stubFetch.received[1].url).toBe(
      "http://localhost:8090/api/projects/acme/envs/prod/collections/posts/schema?force=true",
    );
  });
});
