import { describe, expect, test } from "bun:test";
import { ResolvedEntry } from "../../src/entries/resolved-entry";
import { Search } from "../../src/search/search";
import { SearchReach } from "../../src/search/search-reach";
import { Transport } from "../../src/transport/transport";
import { StubFetch } from "../support/stub-fetch";
import { StubResponse } from "../support/stub-response";

const transportOf = (stubFetch: StubFetch): Transport =>
  new Transport({ url: "http://localhost:8090", fetch: stubFetch.fetch });

const hitOf = (overrides: Record<string, unknown> = {}) => ({
  project: "acme",
  env: "prod",
  collection: "posts",
  entry: {
    id: "01J8",
    rev: 1,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    title: "Hello",
  },
  snippets: [{ path: "$.data.title", before: "", match: "Hello", after: "" }],
  ...overrides,
});

describe("Search reaches", () => {
  test("collection reach", async () => {
    const stubFetch = new StubFetch();
    stubFetch.enqueue(StubResponse.json({ data: [], total: 0, limit: 50, offset: 0, truncated: false, engine: "scan" }));

    await new Search(transportOf(stubFetch), SearchReach.collection("acme", "prod", "posts")).run({ query: "pricing" });

    expect(stubFetch.received[0].url).toBe(
      "http://localhost:8090/api/projects/acme/envs/prod/collections/posts/search?q=pricing",
    );
  });

  test("environment reach", async () => {
    const stubFetch = new StubFetch();
    stubFetch.enqueue(StubResponse.json({ data: [], total: 0, limit: 50, offset: 0, truncated: false, engine: "scan" }));

    await new Search(transportOf(stubFetch), SearchReach.environment("acme", "prod")).run({ query: "pricing" });

    expect(stubFetch.received[0].url).toBe("http://localhost:8090/api/projects/acme/envs/prod/search?q=pricing");
  });

  test("instance reach", async () => {
    const stubFetch = new StubFetch();
    stubFetch.enqueue(StubResponse.json({ data: [], total: 0, limit: 50, offset: 0, truncated: false, engine: "scan" }));

    await new Search(transportOf(stubFetch), SearchReach.instance()).run({ query: "pricing" });

    expect(stubFetch.received[0].url).toBe("http://localhost:8090/api/search?q=pricing");
  });
});

describe("Search.run", () => {
  test("maps a hit's env to environment, and its entry to a ResolvedEntry", async () => {
    const stubFetch = new StubFetch();
    stubFetch.enqueue(
      StubResponse.json({ data: [hitOf()], total: 1, limit: 50, offset: 0, truncated: false, engine: "fts5" }),
    );

    const page = await new Search(transportOf(stubFetch), SearchReach.instance()).run({ query: "pricing" });

    expect(page.hits[0].project).toBe("acme");
    expect(page.hits[0].environment).toBe("prod");
    expect(page.hits[0].collection).toBe("posts");
    expect(page.hits[0].entry).toBeInstanceOf(ResolvedEntry);
    expect(page.hits[0].snippets).toEqual([{ path: "$.data.title", before: "", match: "Hello", after: "" }]);
    expect(page.engine).toBe("fts5");
  });

  test("pageCount is null when truncated", async () => {
    const stubFetch = new StubFetch();
    stubFetch.enqueue(
      StubResponse.json({ data: [hitOf()], total: 50, limit: 50, offset: 0, truncated: true, engine: "scan" }),
    );

    const page = await new Search(transportOf(stubFetch), SearchReach.instance()).run({ query: "pricing" });

    expect(page.truncated).toBe(true);
    expect(page.pageCount).toBeNull();
  });

  test("sends where and sort, and never asks for the stored templates", async () => {
    const stubFetch = new StubFetch();
    stubFetch.enqueue(StubResponse.json({ data: [], total: 0, limit: 50, offset: 0, truncated: false, engine: "scan" }));
    const { Filter } = await import("../../src/query/filter");
    const { Sort } = await import("../../src/query/sort");

    await new Search(transportOf(stubFetch), SearchReach.instance()).run({
      where: Filter.field("status").equals("published"),
      sort: Sort.recentlyUpdated(),
    });

    const url = new URL(stubFetch.received[0].url);
    expect(JSON.parse(url.searchParams.get("filter") ?? "{}")).toEqual({
      op: "eq",
      path: "$.data.status",
      value: "published",
    });
    expect(url.searchParams.get("sort")).toBe("-$.updated_at");
    // A hit is a snapshot, never something to write back, so a search reads
    // resolved whatever the caller is doing elsewhere.
    expect(url.searchParams.get("variables")).toBeNull();
  });
});
