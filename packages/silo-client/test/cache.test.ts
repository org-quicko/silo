import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { Filter, Silo } from "../src/index";

describe("Collection data caching", () => {
  let respond: (request: Request) => Response | Promise<Response>;
  let server: ReturnType<typeof Bun.serve>;
  let url: string;

  beforeEach(() => {
    respond = () => Response.json({ id: "first", rev: 1, title: "Original" });
    server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request) => respond(request),
    });
    url = server.url.toString();
  });

  afterEach(() => server.stop(true));

  test("reuses a collection entry across handles only when this client enables caching", async () => {
    const cached = new Silo({ url, cache: { ttl: 60_000 } });
    const uncached = new Silo({ url });

    expect((await cached.scope("acme", "dev").collection("posts").get("first")).title).toBe("Original");
    expect((await uncached.scope("acme", "dev").collection("posts").get("first")).title).toBe("Original");
    respond = () => Response.json({ id: "first", rev: 2, title: "Changed" });

    expect((await cached.scope("acme", "dev").collection("posts").get("first")).title).toBe("Original");
    expect((await uncached.scope("acme", "dev").collection("posts").get("first")).title).toBe("Changed");
  });

  test("caches page data while keeping navigation, streams and returned entries independent", async () => {
    respond = (request) => {
      const offset = Number(new URL(request.url).searchParams.get("offset") ?? 0);
      return Response.json({
        data: offset < 2 ? [{ id: offset === 0 ? "first" : "second", rev: 1, title: "Original" }] : [],
        total: 2, limit: 1, offset,
      });
    };
    const posts = new Silo({ url, cache: { ttl: 60_000 } }).scope("acme", "dev").collection("posts");
    const first = await posts.list({ limit: 1, offset: 0 });
    expect((await first.next())?.entries[0]?.id).toBe("second");
    await posts.list({ limit: 1, offset: 2 });
    first.entries[0]!.title = "Changed by caller";
    respond = () => Response.json({ error: "cached pages should be available" }, { status: 503 });

    const again = await posts.list({ limit: 1, offset: 0 });
    expect(again.entries[0]?.title).toBe("Original");
    expect((await (await again.next())?.previous())?.entries[0]?.id).toBe("first");
    const ids = [];
    for await (const entry of posts.all({ limit: 1, offset: 0 })) ids.push(entry.id);
    expect(ids).toEqual(["first", "second"]);
    const pages = [];
    for await (const page of posts.pages({ limit: 1, offset: 0 })) pages.push(page.offset);
    expect(pages).toEqual([0, 1]);
  });

  test("keeps collection, environment and global searches fresh when caching is enabled", async () => {
    let title = "Original";
    respond = (request) => {
      const offset = Number(new URL(request.url).searchParams.get("offset") ?? 0);
      return Response.json({
        data: [{ project: "acme", env: "dev", collection: "posts", entry: { id: String(offset), rev: 1, title }, snippets: {} }],
        total: 2, limit: 1, offset, truncated: false, engine: "fts5",
      });
    };
    const silo = new Silo({ url, cache: { ttl: 60_000 } });
    const environment = silo.scope("acme", "dev");
    const posts = environment.collection("posts");
    const query = { query: "hello", limit: 1, offset: 0 };
    const first = await posts.search(query);
    await first.next();
    await silo.search(query);
    await environment.search(query);
    title = "Changed";

    const again = await posts.search(query);
    expect(again.hits[0]?.entry.title).toBe("Changed");
    expect((await again.next())?.hits[0]?.entry.title).toBe("Changed");
    expect((await posts.search({ ...query, query: "different" })).hits[0]?.entry.title).toBe("Changed");
    expect((await silo.search(query)).hits[0]?.entry.title).toBe("Changed");
    expect((await environment.search(query)).hits[0]?.entry.title).toBe("Changed");
  });

  test("clears this client's cached data for its existing handles", async () => {
    const silo = new Silo({ url, cache: { ttl: 60_000 } });
    const posts = silo.scope("acme", "dev").collection("posts");
    await posts.get("first");
    respond = () => Response.json({ id: "first", rev: 2, title: "Changed" });
    silo.clearCache();

    expect((await posts.get("first")).title).toBe("Changed");
    expect(() => new Silo({ url }).clearCache()).not.toThrow();
  });

  test("expires at the configured TTL even when eviction timers have not run", async () => {
    const clock = spyOn(performance, "now").mockReturnValue(1_000);
    try {
      const posts = new Silo({ url, cache: { ttl: 60_000 } }).scope("acme", "dev").collection("posts");
      await posts.get("first");
      respond = () => Response.json({ id: "first", rev: 2, title: "Changed" });
      clock.mockReturnValue(60_999);
      expect((await posts.get("first")).title).toBe("Original");
      clock.mockReturnValue(61_001);
      expect((await posts.get("first")).title).toBe("Changed");
    } finally {
      clock.mockRestore();
    }
  });

  test.each([undefined, 1])("applies max only when supplied: %s", async (max) => {
    const posts = new Silo({ url, cache: { ttl: 60_000, ...(max === undefined ? {} : { max }) } })
      .scope("acme", "dev").collection("posts");
    await posts.get("first");
    for (let index = 0; index < (max === undefined ? 1001 : 1); index += 1) {
      await posts.get(`other-${index}`);
    }
    respond = () => Response.json({ id: "first", rev: 2, title: "Changed" });

    expect((await posts.get("first")).title).toBe(max === undefined ? "Original" : "Changed");
  });

  test("keeps the client's headers fixed so URL-only cache keys remain valid", async () => {
    respond = (request) => Response.json({ id: "first", rev: 1, title: request.headers.get("X-Tenant") });
    const headers = { "X-Tenant": "initial" };
    const silo = new Silo({ url, headers, cache: { ttl: 60_000 } });
    const posts = silo.scope("acme", "dev").collection("posts");
    await posts.get("first");
    headers["X-Tenant"] = "changed";

    expect((await posts.get("second")).title).toBe("initial");
    expect((await silo.withKey("another-key").scope("acme", "dev").collection("posts").get("first")).title)
      .toBe("initial");
  });

  test("separates entries by project, environment, collection, id and query parameters", async () => {
    const silo = new Silo({ url, cache: { ttl: 60_000 } });
    const posts = silo.scope("acme", "dev").collection("posts");
    const reads = [
      { title: "Resolved", read: () => posts.get("first") },
      { title: "Raw", read: () => posts.get("first", { variables: "raw" }) },
      { title: "Another entry", read: () => posts.get("second") },
      { title: "Another collection", read: () => silo.scope("acme", "dev").collection("movies").get("first") },
      { title: "Another environment", read: () => silo.scope("acme", "prod").collection("posts").get("first") },
      { title: "Another project", read: () => silo.scope("other", "dev").collection("posts").get("first") },
    ];
    for (const { title, read } of reads) {
      respond = () => Response.json({ id: "first", rev: 1, title });
      expect((await read()).title).toBe(title);
    }
    respond = () => Response.json({}, { status: 503 });
    for (const { title, read } of reads) expect((await read()).title).toBe(title);
  });

  test("gives new clients, withKey and withUrl independent caches", async () => {
    const options = { url, key: "first-key", cache: { ttl: 60_000 } };
    const silo = new Silo(options);
    const posts = silo.scope("acme", "dev").collection("posts");
    await posts.get("first");
    respond = () => Response.json({ id: "first", rev: 2, title: "Changed" });

    for (const other of [new Silo(options), silo.withKey("second-key"), silo.withUrl(url)]) {
      expect((await other.scope("acme", "dev").collection("posts").get("first")).title).toBe("Changed");
      other.clearCache();
    }
    expect((await posts.get("first")).title).toBe("Original");
  });

  test.each([200, 204, 404, 503])("does not cache an empty or failed response with status %s", async (status) => {
    const posts = new Silo({ url, cache: { ttl: 60_000 } }).scope("acme", "dev").collection("posts");
    respond = () => status === 204 ? new Response(null, { status }) : Response.json(null, { status });
    if (status >= 400) await expect(posts.get("first")).rejects.toBeInstanceOf(Error);
    else if (status === 204) expect(await posts.get("first")).toBeUndefined();
    else expect(await posts.get("first")).toBeNull();
    respond = () => Response.json({ id: "first", rev: 1, title: "Recovered" });

    expect((await posts.get("first")).title).toBe("Recovered");
  });

  test("keeps health, schema and writes fresh without invalidating cached entries", async () => {
    let title = "Original";
    respond = () => Response.json({ id: "first", rev: 1, title, name: title, version: title, status: "ok" });
    const silo = new Silo({ url, cache: { ttl: 60_000 } });
    const posts = silo.scope("acme", "dev").collection("posts");
    await silo.health();
    await posts.schema.get();
    await posts.create({ title: "New post" });
    await posts.get("first");
    title = "Changed";

    expect((await silo.health()).version).toBe("Changed");
    expect((await posts.schema.get()).name).toBe("Changed");
    expect((await posts.create({ title: "New post" })).title).toBe("Changed");
    expect((await posts.get("first")).title).toBe("Original");
  });

  test("preserves the base path and JSON query encoding for distinct cached filters", async () => {
    respond = (request) => {
      const received = new URL(request.url);
      return Response.json({
        data: [{ id: "first", rev: 1, filter: received.searchParams.get("filter"), path: received.pathname }],
        total: 1, limit: 10, offset: 0,
      });
    };
    const posts = new Silo({ url: `${url}gateway/`, cache: { ttl: 60_000 } })
      .scope("acme", "dev").collection("posts");
    const firstQuery = { where: Filter.raw({ op: "eq", path: "$.data.title", value: "A + B & C / café" }), limit: 10 };
    const secondQuery = { where: Filter.raw({ op: "eq", path: "$.data.title", value: "Different" }), limit: 10 };
    const first = await posts.list(firstQuery);
    const second = await posts.list(secondQuery);

    expect(first.entries[0]?.filter).toBe('{"op":"eq","path":"$.data.title","value":"A + B & C / café"}');
    expect(second.entries[0]?.filter).toBe('{"op":"eq","path":"$.data.title","value":"Different"}');
    expect(first.entries[0]?.path).toBe("/gateway/api/projects/acme/envs/dev/collections/posts");
    respond = () => Response.json({}, { status: 503 });
    expect((await posts.list(firstQuery)).entries).toEqual(first.entries);
    expect((await posts.list(secondQuery)).entries).toEqual(second.entries);
  });
});
