import { describe, expect, test } from "bun:test";
import { SiloCache } from "../../src/cache/silo-cache";
import { Silo } from "../../src/silo";
import type { FetchFunction } from "../../src/transport/fetch-function";
import { StubFetch } from "../support/stub-fetch";
import { StubResponse } from "../support/stub-response";

describe("cache identity and modes", () => {
  test("disabled clients make every GET", async () => {
    const stub = new StubFetch();
    stub.enqueue(StubResponse.json({ items: [] }));
    stub.enqueue(StubResponse.json({ items: [] }));
    const client = new Silo({ url: "http://localhost:8090", fetch: stub.fetch });

    await client.projects.list();
    await client.projects.list();
    expect(stub.received).toHaveLength(2);
  });

  test("the count cap evicts the oldest key", async () => {
    const stub = new StubFetch();
    stub.enqueue(StubResponse.json({ items: [{ id: "project" }] }));
    stub.enqueue(StubResponse.json({ items: ["png"] }));
    stub.enqueue(StubResponse.json({ items: [{ id: "project-again" }] }));
    const client = new Silo({ url: "http://localhost:8090", fetch: stub.fetch, cache: { ttlMilliseconds: 1_000, maxEntries: 1 } });

    await client.projects.list();
    await client.media.extensions();
    expect((await client.projects.list())[0]?.id).toBe("project-again");
    expect(stub.received).toHaveLength(3);
  });

  test("authorization and normalized header values partition a shared cache", async () => {
    const cache = new SiloCache({ ttlMilliseconds: 1_000 });
    let calls = 0;
    const fetch = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      calls += 1;
      return Response.json({ items: [{ id: new Headers(init?.headers).get("authorization") ?? "anonymous" }] });
    };
    const first = new Silo({ url: "http://localhost:8090", key: "first", fetch, cache });
    const second = new Silo({ url: "http://localhost:8090", key: "second", fetch, cache });

    expect((await first.projects.list())[0]?.id).toBe("Bearer first");
    expect((await second.projects.list())[0]?.id).toBe("Bearer second");
    await first.projects.list();
    await second.projects.list();
    expect(calls).toBe(2);
  });

  test("duplicate differently-cased headers retain their normalized value order", async () => {
    const cache = new SiloCache({ ttlMilliseconds: 1_000 });
    let calls = 0;
    const fetch = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      calls += 1;
      return Response.json({ items: [{ id: new Headers(init?.headers).get("x-mode") }] });
    };
    const first = new Silo({ url: "http://localhost:8090", cache, fetch, headers: { "X-Mode": "one", "x-mode": "two" } });
    const second = new Silo({ url: "http://localhost:8090", cache, fetch, headers: { "x-mode": "two", "X-Mode": "one" } });

    expect((await first.projects.list())[0]?.id).toBe("one, two");
    expect((await second.projects.list())[0]?.id).toBe("two, one");
    expect(calls).toBe(2);
  });

  test("equivalent duplicate header casing shares a key and headers are prepared once", async () => {
    const cache = new SiloCache({ ttlMilliseconds: 1_000 });
    let calls = 0;
    let reads = 0;
    const headers: Record<string, string> = {};
    Object.defineProperty(headers, "X-Mode", { enumerable: true, get: () => { reads += 1; return "one"; } });
    headers["x-mode"] = "two";
    const fetch = async (): Promise<Response> => {
      calls += 1;
      return Response.json({ items: [] });
    };
    const first = new Silo({ url: "http://localhost:8090", cache, fetch, headers });
    const second = new Silo({ url: "http://localhost:8090", cache, fetch, headers: { "x-MODE": "one", "X-mode": "two" } });

    await first.projects.list();
    await second.projects.list();
    expect(calls).toBe(1);
    expect(reads).toBe(1);
  });

  test("a shared cache separates URLs, raw reads and query windows", async () => {
    const cache = new SiloCache({ ttlMilliseconds: 1_000 });
    let calls = 0;
    const fetch = async (): Promise<Response> => {
      calls += 1;
      return Response.json({ items: [], total: 0, limit: 1, offset: 0 });
    };
    const first = new Silo({ url: "http://localhost:8090", cache, fetch });
    const second = first.withUrl("http://staging:8090");
    const posts = first.scope("acme", "prod").collection("posts");

    await first.projects.list();
    await second.projects.list();
    await posts.list({ limit: 1 });
    await posts.list({ limit: 2 });
    await posts.get("entry");
    await posts.get("entry", { variables: "raw" });
    expect(calls).toBe(6);
  });

  test("withKey and withUrl retain the cache, while an explicitly shared cache serves both clients", async () => {
    const cache = new SiloCache({ ttlMilliseconds: 1_000 });
    let calls = 0;
    const fetch = async (): Promise<Response> => {
      calls += 1;
      return Response.json({ items: [] });
    };
    const first = new Silo({ url: "http://localhost:8090", cache, fetch });
    const sameKey = first.withKey(undefined);
    const shared = new Silo({ url: "http://localhost:8090", cache, fetch });

    await first.projects.list();
    await sameKey.projects.list();
    await shared.projects.list();
    expect(sameKey.cache).toBe(cache);
    expect(first.withUrl("http://localhost:8090/").cache).toBe(cache);
    expect(calls).toBe(1);
  });

  test("errors and malformed JSON are never cached", async () => {
    let calls = 0;
    const notFound: FetchFunction = async () => {
      calls += 1;
      return new Response(JSON.stringify({ code: "not_found", message: "missing" }), { status: 404 });
    };
    const silo = new Silo({ url: "http://localhost:8090", fetch: notFound, cache: { ttlMilliseconds: 1_000 } });
    await expect(silo.projects.list()).rejects.toThrow();
    await expect(silo.projects.list()).rejects.toThrow();
    expect(calls).toBe(2);

    calls = 0;
    const invalid = new Silo({
      url: "http://localhost:8090", cache: { ttlMilliseconds: 1_000 },
      fetch: async () => { calls += 1; return new Response("{", { status: 200, headers: { "content-type": "application/json" } }); },
    });
    await expect(invalid.projects.list()).rejects.toThrow();
    await expect(invalid.projects.list()).rejects.toThrow();
    expect(calls).toBe(2);
  });

});
