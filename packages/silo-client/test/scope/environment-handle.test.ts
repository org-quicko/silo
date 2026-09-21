import { describe, expect, test } from "bun:test";
import { CollectionHandle } from "../../src/collections/collection-handle";
import { EnvironmentHandle } from "../../src/scope/environment-handle";
import { ScopeReference } from "../../src/scope/scope-reference";
import { Transport } from "../../src/transport/transport";
import { StubFetch } from "../support/stub-fetch";
import { StubResponse } from "../support/stub-response";

interface Post {
  title: string;
}

const handleOf = (stubFetch: StubFetch): EnvironmentHandle => {
  const scope = new ScopeReference(new Transport({ url: "http://localhost:8090", fetch: stubFetch.fetch }), "acme", "prod");
  return new EnvironmentHandle(scope);
};

describe("EnvironmentHandle", () => {
  test("collection<Fields>() builds a handle with no request", () => {
    const stubFetch = new StubFetch();
    const posts = handleOf(stubFetch).collection<Post>("posts");

    expect(posts).toBeInstanceOf(CollectionHandle);
    expect(stubFetch.received).toHaveLength(0);
  });

  test("schemas() GETs every schema in the scope in one request", async () => {
    const stubFetch = new StubFetch();
    stubFetch.enqueue(StubResponse.json({ items: [{ id: "01J8", name: "posts", schema: { type: "object" } }] }));

    const schemas = await handleOf(stubFetch).schemas();

    expect(stubFetch.received[0].url).toBe("http://localhost:8090/api/projects/acme/envs/prod/schemas");
    expect(schemas).toEqual([{ id: "01J8", name: "posts", schema: { type: "object" } }]);
  });

  test("rename() PATCHes the environment", async () => {
    const stubFetch = new StubFetch();
    stubFetch.enqueue(
      StubResponse.json({ id: "01J9", from: "prod", to: "preprod", rewritten_claims: [], pattern_affected_claims: [] }),
    );

    const report = await handleOf(stubFetch).rename("preprod");

    expect(stubFetch.received[0].method).toBe("PATCH");
    expect(stubFetch.received[0].url).toBe("http://localhost:8090/api/projects/acme/envs/prod");
    expect(report.to).toBe("preprod");
  });

  test("delete() sends ?force=true only when asked", async () => {
    const stubFetch = new StubFetch();
    stubFetch.enqueue(StubResponse.empty());

    await handleOf(stubFetch).delete({ force: true });

    expect(stubFetch.received[0].url).toBe("http://localhost:8090/api/projects/acme/envs/prod?force=true");
  });

  test("search() runs against this environment's reach", async () => {
    const stubFetch = new StubFetch();
    stubFetch.enqueue(
      StubResponse.json({ data: [], total: 0, limit: 50, offset: 0, truncated: false, engine: "scan" }),
    );

    await handleOf(stubFetch).search({ query: "pricing" });

    expect(stubFetch.received[0].url).toBe(
      "http://localhost:8090/api/projects/acme/envs/prod/search?q=pricing",
    );
  });
});
