import { describe, expect, test } from "bun:test";
import { Silo } from "../src/silo";
import { StubFetch } from "./support/stub-fetch";
import { StubResponse } from "./support/stub-response";
import type { RecordedRequest } from "./support/stub-fetch";

/** The most recent call, for the assertions that only care about the last. */
function lastOf(stub: StubFetch): RecordedRequest {
  const request = stub.received[stub.received.length - 1];
  if (!request) throw new Error("no request was recorded");
  return request;
}

interface Post {
  title: string;
  status: "draft" | "published";
}

function entryBody(id: string, rev: number): Record<string, unknown> {
  return {
    id,
    rev,
    title: "Hello",
    status: "draft",
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
  };
}

describe("Silo", () => {
  test("health asks the one unauthenticated route and sends no key", async () => {
    const stub = new StubFetch();
    stub.enqueue(StubResponse.json({ status: "ok", version: "1.0.0" }));
    const silo = new Silo({ url: "http://localhost:8090", fetch: stub.fetch });

    const report = await silo.health();

    expect(report.version).toBe("1.0.0");
    expect(lastOf(stub).url).toBe("http://localhost:8090/api/health");
    expect(lastOf(stub).headers["authorization"]).toBeUndefined();
  });

  test("presents the key as a bearer token when one is set", async () => {
    const stub = new StubFetch();
    stub.enqueue(StubResponse.json({ items: [] }));
    await new Silo({ url: "http://localhost:8090/", key: "silo_abc", fetch: stub.fetch }).projects.list();

    expect(lastOf(stub).headers["authorization"]).toBe("Bearer silo_abc");
    expect(lastOf(stub).url).toBe("http://localhost:8090/api/projects");
  });

  test("navigates project, environment and collection into one path", async () => {
    const stub = new StubFetch();
    stub.enqueue(StubResponse.json(entryBody("01J8", 3)));
    const silo = new Silo({ url: "http://localhost:8090", fetch: stub.fetch });

    await silo.project("acme").environment("prod").collection<Post>("posts").get("01J8");

    expect(lastOf(stub).url).toBe(
      "http://localhost:8090/api/projects/acme/envs/prod/collections/posts/01J8",
    );
  });

  test("scope is the two-call chain and still takes both names", async () => {
    const stub = new StubFetch();
    stub.enqueue(StubResponse.json(entryBody("01J8", 1)));
    const silo = new Silo({ url: "http://localhost:8090", fetch: stub.fetch });

    await silo.scope("acme", "prod").collection<Post>("posts").get("01J8");

    expect(lastOf(stub).url).toContain("/api/projects/acme/envs/prod/collections/posts/");
  });

  test("get has no save through the whole chain, and edit does", async () => {
    const stub = new StubFetch();
    stub.enqueue(StubResponse.json(entryBody("01J8", 1)));
    stub.enqueue(StubResponse.json(entryBody("01J8", 1)));
    const posts = new Silo({ url: "http://x", fetch: stub.fetch })
      .project("acme").environment("prod").collection<Post>("posts");

    const resolved = await posts.get("01J8");
    // @ts-expect-error a read whose variables are substituted is not editable
    resolved.save;

    const editable = await posts.edit("01J8");
    expect(typeof editable.save).toBe("function");
  });

  test("only the editable surface asks for the stored templates", async () => {
    const stub = new StubFetch();
    for (let queued = 0; queued < 4; queued += 1) {
      stub.enqueue(StubResponse.json(entryBody("01J8", 1)));
    }
    const posts = new Silo({ url: "http://x", fetch: stub.fetch })
      .scope("acme", "prod").collection<Post>("posts");

    await posts.get("01J8");
    expect(stub.received[0]!.url).not.toContain("variables=raw");

    await posts.edit("01J8");
    expect(stub.received[1]!.url).toContain("variables=raw");

    await posts.editable.get("01J8");
    expect(stub.received[2]!.url).toContain("variables=raw");

    await posts.create({ title: "Hello", status: "draft" });
    expect(stub.received[3]!.url).toContain("variables=raw");
  });

  test("search reaches the instance from the client and the collection from a handle", async () => {
    const stub = new StubFetch();
    stub.enqueue(StubResponse.json({ data: [], total: 0, limit: 50, offset: 0, truncated: false, engine: "fts5" }));
    stub.enqueue(StubResponse.json({ data: [], total: 0, limit: 50, offset: 0, truncated: false, engine: "fts5" }));
    const silo = new Silo({ url: "http://x", fetch: stub.fetch });

    await silo.search({ query: "pricing" });
    expect(stub.received[0]!.url).toContain("/api/search?");

    await silo.scope("acme", "prod").collection<Post>("posts").search({ query: "pricing" });
    expect(stub.received[1]!.url).toContain("/api/projects/acme/envs/prod/collections/posts/search?");
  });

  test("withKey and withUrl derive a client and leave the original alone", async () => {
    const stub = new StubFetch();
    stub.enqueue(StubResponse.json({ items: [] }));
    stub.enqueue(StubResponse.json({ items: [] }));
    const silo = new Silo({ url: "http://localhost:8090", key: "silo_first", fetch: stub.fetch });

    await silo.withKey("silo_second").withUrl("https://staging.example.com").projects.list();
    expect(stub.received[0]!.url).toBe("https://staging.example.com/api/projects");
    expect(stub.received[0]!.headers["authorization"]).toBe("Bearer silo_second");

    await silo.projects.list();
    expect(stub.received[1]!.url).toBe("http://localhost:8090/api/projects");
    expect(stub.received[1]!.headers["authorization"]).toBe("Bearer silo_first");
  });

  test("the editable surface pages like the resolved one", async () => {
    const stub = new StubFetch();
    stub.enqueue(StubResponse.json({ data: [entryBody("01J8", 1)], total: 1, limit: 50, offset: 0 }));

    const page = await new Silo({ url: "http://x", fetch: stub.fetch })
      .scope("acme", "prod").collection<Post>("posts").editable.list();

    expect(page.entries).toHaveLength(1);
    expect(typeof page.entries[0]!.save).toBe("function");
    expect(stub.received[0]!.url).toContain("variables=raw");
  });

  test("media hangs off the client, since the catalog is instance-global", async () => {
    const stub = new StubFetch();
    stub.enqueue(StubResponse.json({ items: [], total: 0, limit: 50, offset: 0 }));
    await new Silo({ url: "http://x", fetch: stub.fetch }).media.list();

    expect(lastOf(stub).url).toContain("/api/media");
  });
  test("an untyped collection still reads its fields, so the first example compiles", async () => {
    const stub = new StubFetch();
    stub.enqueue(StubResponse.json(entryBody("01J8", 1)));

    const post = await new Silo({ url: "http://x", fetch: stub.fetch })
      .scope("acme", "prod").collection("posts").get("01J8");

    expect(post.fields.title).toBe("Hello");
  });
});
