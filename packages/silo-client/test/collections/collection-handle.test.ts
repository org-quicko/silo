import { describe, expect, test } from "bun:test";
import { CollectionHandle } from "../../src/collections/collection-handle";
import { Entry } from "../../src/entries/entry";
import { ScopeReference } from "../../src/scope/scope-reference";
import { Transport } from "../../src/transport/transport";
import { StubFetch } from "../support/stub-fetch";
import { StubResponse } from "../support/stub-response";

interface Post {
  title: string;
  status: string;
}

const scopeOf = (stubFetch: StubFetch): ScopeReference =>
  new ScopeReference(new Transport({ url: "http://localhost:8090", fetch: stubFetch.fetch }), "acme", "prod");

const entryPayload = (overrides: Partial<Post> & { rev?: number } = {}) => ({
  id: "01J8 x",
  rev: 1,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  title: "Hello",
  status: "draft",
  ...overrides,
});

describe("CollectionHandle.get", () => {
  test("on a resolved-mode handle: no ?variables=, and the result has no save()", async () => {
    const stubFetch = new StubFetch();
    stubFetch.enqueue(StubResponse.json(entryPayload()));
    const posts = new CollectionHandle<Post>(scopeOf(stubFetch), "my posts");

    const entry = await posts.get("01J8 x");

    expect(stubFetch.received[0].method).toBe("GET");
    expect(stubFetch.received[0].url).toBe(
      "http://localhost:8090/api/projects/acme/envs/prod/collections/my%20posts/01J8%20x",
    );
    expect((entry as unknown as { save?: unknown }).save).toBeUndefined();
  });

  test("through editable: sends ?variables=raw, and the result has save()", async () => {
    const stubFetch = new StubFetch();
    stubFetch.enqueue(StubResponse.json(entryPayload()));
    const posts = new CollectionHandle<Post>(scopeOf(stubFetch), "posts");

    const entry = await posts.editable.get("01J8 x");

    expect(stubFetch.received[0].url).toContain("variables=raw");
    expect(stubFetch.received[0].url).toContain("01J8%20x");
    expect(entry).toBeInstanceOf(Entry);
    expect(typeof entry.save).toBe("function");
  });
});

describe("CollectionHandle.edit / create / replace", () => {
  test("edit() always reads ?variables=raw regardless of client mode", async () => {
    const stubFetch = new StubFetch();
    stubFetch.enqueue(StubResponse.json(entryPayload({ title: "{{TITLE}}" })));
    const posts = new CollectionHandle<Post>(scopeOf(stubFetch), "posts");

    const draft = await posts.edit("01J8 x");

    expect(stubFetch.received[0].url).toContain("variables=raw");
    expect(draft.fields.title).toBe("{{TITLE}}");
    expect(typeof draft.save).toBe("function");
  });

  test("create() sends POST with ?variables=raw and the fields as the body", async () => {
    const stubFetch = new StubFetch();
    stubFetch.enqueue(StubResponse.json(entryPayload({ rev: 1 }), 201));
    const posts = new CollectionHandle<Post>(scopeOf(stubFetch), "posts");

    const created = await posts.create({ title: "Hello", status: "draft" });

    expect(stubFetch.received[0].method).toBe("POST");
    expect(stubFetch.received[0].url).toBe(
      "http://localhost:8090/api/projects/acme/envs/prod/collections/posts?variables=raw",
    );
    expect(JSON.parse(stubFetch.received[0].body ?? "{}")).toEqual({ title: "Hello", status: "draft" });
    expect(typeof created.save).toBe("function");
  });

  test("replace() sends PUT with the given rev and ?variables=raw", async () => {
    const stubFetch = new StubFetch();
    stubFetch.enqueue(StubResponse.json(entryPayload({ rev: 6 })));
    const posts = new CollectionHandle<Post>(scopeOf(stubFetch), "posts");

    await posts.replace("01J8 x", 5, { title: "Hello again", status: "published" });

    expect(stubFetch.received[0].method).toBe("PUT");
    expect(stubFetch.received[0].url).toBe(
      "http://localhost:8090/api/projects/acme/envs/prod/collections/posts/01J8%20x?rev=5&variables=raw",
    );
  });
});

describe("CollectionHandle.delete", () => {
  test("sends DELETE with ?rev=", async () => {
    const stubFetch = new StubFetch();
    stubFetch.enqueue(StubResponse.empty());
    const posts = new CollectionHandle<Post>(scopeOf(stubFetch), "posts");

    await posts.delete("01J8 x", 3);

    expect(stubFetch.received[0].method).toBe("DELETE");
    expect(stubFetch.received[0].url).toBe(
      "http://localhost:8090/api/projects/acme/envs/prod/collections/posts/01J8%20x?rev=3",
    );
  });
});

describe("CollectionHandle.list", () => {
  test("a default list() sends no ?variables=, and answers total/limit/offset", async () => {
    const stubFetch = new StubFetch();
    stubFetch.enqueue(StubResponse.json({ data: [entryPayload()], total: 1, limit: 50, offset: 0 }));
    const posts = new CollectionHandle<Post>(scopeOf(stubFetch), "posts");

    const page = await posts.list();

    expect(stubFetch.received[0].url).not.toContain("variables");
    expect(page.entries).toHaveLength(1);
    expect(page.total).toBe(1);
    expect(page.limit).toBe(50);
  });

  test("editable.list() sends ?variables=raw and answers editable entries", async () => {
    const stubFetch = new StubFetch();
    stubFetch.enqueue(StubResponse.json({ data: [entryPayload()], total: 1, limit: 50, offset: 0 }));
    const posts = new CollectionHandle<Post>(scopeOf(stubFetch), "posts");

    const page = await posts.editable.list();

    expect(stubFetch.received[0].url).toContain("variables=raw");
    expect(page.entries[0]).toBeInstanceOf(Entry);
    expect(typeof page.entries[0]!.save).toBe("function");
  });

  test("sends the filter and sort, and next() requests the echoed window, not the one asked for", async () => {
    const stubFetch = new StubFetch();
    stubFetch.enqueue(StubResponse.json({ data: [entryPayload()], total: 501, limit: 500, offset: 0 }));
    stubFetch.enqueue(StubResponse.json({ data: [entryPayload()], total: 501, limit: 500, offset: 500 }));
    const posts = new CollectionHandle<Post>(scopeOf(stubFetch), "posts");

    const first = await posts.list({ where: posts.filter.field("status").equals("published"), limit: 900 });
    const firstUrl = new URL(stubFetch.received[0].url);
    expect(firstUrl.searchParams.get("limit")).toBe("900");
    expect(JSON.parse(firstUrl.searchParams.get("filter") ?? "{}")).toEqual({
      op: "eq",
      path: "$.data.status",
      value: "published",
    });
    expect(first.limit).toBe(500);

    await first.next();
    const secondUrl = new URL(stubFetch.received[1].url);
    expect(secondUrl.searchParams.get("offset")).toBe("500");
    expect(secondUrl.searchParams.get("limit")).toBe("500");
    expect(JSON.parse(secondUrl.searchParams.get("filter") ?? "{}")).toEqual({
      op: "eq",
      path: "$.data.status",
      value: "published",
    });
  });
});

describe("CollectionHandle.all / pages", () => {
  test("all() streams every row across pages", async () => {
    const stubFetch = new StubFetch();
    stubFetch.enqueue(
      StubResponse.json({
        data: [entryPayload({ title: "a" }), entryPayload({ title: "b" })],
        total: 3,
        limit: 2,
        offset: 0,
      }),
    );
    stubFetch.enqueue(StubResponse.json({ data: [entryPayload({ title: "c" })], total: 3, limit: 2, offset: 2 }));
    const posts = new CollectionHandle<Post>(scopeOf(stubFetch), "posts");

    const titles: string[] = [];
    for await (const entry of posts.all({ limit: 2 })) titles.push(entry.fields.title);

    expect(titles).toEqual(["a", "b", "c"]);
  });

  test("pages() streams whole pages", async () => {
    const stubFetch = new StubFetch();
    stubFetch.enqueue(StubResponse.json({ data: [entryPayload()], total: 1, limit: 50, offset: 0 }));
    const posts = new CollectionHandle<Post>(scopeOf(stubFetch), "posts");

    const pages: number[] = [];
    for await (const page of posts.pages()) pages.push(page.entries.length);

    expect(pages).toEqual([1]);
  });
});

describe("CollectionHandle.rename", () => {
  test("a dry run's id feeds the real call as expectedId, appearing as expected_id", async () => {
    const stubFetch = new StubFetch();
    stubFetch.enqueue(
      StubResponse.json({
        id: "01J8COL",
        from: "posts",
        to: "articles",
        rewritten_claims: [],
        pattern_affected_claims: [],
      }),
    );
    stubFetch.enqueue(
      StubResponse.json({
        id: "01J8COL",
        from: "posts",
        to: "articles",
        rewritten_claims: ["collections:acme/prod/posts:*"],
        pattern_affected_claims: [],
      }),
    );
    const posts = new CollectionHandle<Post>(scopeOf(stubFetch), "posts");

    const preview = await posts.rename("articles", { dryRun: true });
    expect(stubFetch.received[0].url).toContain("dry_run=true");
    expect(preview.id).toBe("01J8COL");

    const report = await posts.rename("articles", { expectedId: preview.id });
    const secondUrl = new URL(stubFetch.received[1].url);
    expect(secondUrl.searchParams.get("expected_id")).toBe("01J8COL");
    expect(secondUrl.searchParams.has("dry_run")).toBe(false);
    expect(report.rewrittenClaims).toEqual(["collections:acme/prod/posts:*"]);
  });
});

describe("CollectionHandle.search", () => {
  test("searches this collection's own reach", async () => {
    const stubFetch = new StubFetch();
    stubFetch.enqueue(
      StubResponse.json({ data: [], total: 0, limit: 50, offset: 0, truncated: false, engine: "scan" }),
    );
    const posts = new CollectionHandle<Post>(scopeOf(stubFetch), "posts");

    await posts.search({ query: "pricing" });

    expect(stubFetch.received[0].url).toBe(
      "http://localhost:8090/api/projects/acme/envs/prod/collections/posts/search?q=pricing",
    );
  });
});
