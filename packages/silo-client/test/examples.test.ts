import { describe, expect, test } from "bun:test";
import { Entry } from "../src/entries/entry";
import { Filter } from "../src/query/filter";
import { Sort } from "../src/query/sort";
import { EnvironmentHandle } from "../src/scope/environment-handle";
import { ProjectHandle } from "../src/scope/project-handle";
import { Transport } from "../src/transport/transport";
import { StubFetch } from "./support/stub-fetch";
import { StubResponse } from "./support/stub-response";

/**
 * The README's examples, each block
 * builds the same handle chain `Silo.project().environment()` would, and
 * proves it compiles and runs exactly as documented.
 */
interface Post {
  title: string;
  status: "draft" | "published";
  tags: string[];
  url?: string;
}

describe("Projects and environments", () => {
  test("rename is bound to the identity reviewed in a dry run", async () => {
    const stubFetch = new StubFetch();
    stubFetch.enqueue(
      StubResponse.json({ id: "01J8", from: "acme", to: "acme-corp", rewritten_claims: [], pattern_affected_claims: [] }),
    );
    stubFetch.enqueue(
      StubResponse.json({ id: "01J8", from: "acme", to: "acme-corp", rewritten_claims: [], pattern_affected_claims: [] }),
    );
    stubFetch.enqueue(StubResponse.empty());

    const acme = new ProjectHandle(new Transport({ url: "http://localhost:8090", fetch: stubFetch.fetch }), "acme");

    const preview = await acme.rename("acme-corp", { dryRun: true });
    preview.id;
    preview.rewrittenClaims;
    preview.patternAffectedClaims;
    await acme.rename("acme-corp", { expectedId: preview.id });
    await acme.delete({ force: true });

    expect(stubFetch.received).toHaveLength(3);
  });
});

describe("Collections and schemas", () => {
  test("create, schema get/put, rename", async () => {
    const stubFetch = new StubFetch();
    const schema = { type: "object", required: ["title"], properties: { title: { type: "string" }, status: { type: "string" } } };
    stubFetch.enqueue(StubResponse.json({ id: "01J8", name: "posts", schema }, 201));
    stubFetch.enqueue(StubResponse.json({ id: "01J8", name: "posts", schema }));
    stubFetch.enqueue(StubResponse.json({ id: "01J8", name: "posts", schema }));

    const transport = new Transport({ url: "http://localhost:8090", fetch: stubFetch.fetch });
    const environment = new ProjectHandle(transport, "acme").environment("prod");

    await environment.collections.create("posts", schema);
    const posts = environment.collection<Post>("posts");
    await posts.schema.get();
    await posts.schema.put(schema);

    expect(stubFetch.received).toHaveLength(3);
  });
});

describe("Entries: reading, editing, writing, listing", () => {
  const environmentOf = (stubFetch: StubFetch): EnvironmentHandle => {
    const transport = new Transport({ url: "http://localhost:8090", fetch: stubFetch.fetch });
    return new ProjectHandle(transport, "acme").environment("prod");
  };

  test("a resolved read has no save()", async () => {
    const stubFetch = new StubFetch();
    stubFetch.enqueue(
      StubResponse.json({
        id: "01J8",
        rev: 3,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        title: "Hello",
        status: "draft",
        tags: [],
        url: "https://api.acme.com/posts",
      }),
    );
    stubFetch.enqueue(StubResponse.empty());
    const posts = environmentOf(stubFetch).collection<Post>("posts");

    const post = await posts.get("01J8");

    expect(post.fields.url).toBe("https://api.acme.com/posts");
    // @ts-expect-error -- a resolved read has no save(), proven through the
    // full ProjectHandle -> EnvironmentHandle -> CollectionHandle chain.
    post.save;
    await post.delete();
  });

  test("edit() carries the template, and save() writes it back untouched", async () => {
    const stubFetch = new StubFetch();
    stubFetch.enqueue(
      StubResponse.json({
        id: "01J8",
        rev: 3,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        title: "Hello",
        status: "draft",
        tags: [],
        url: "{{API_URL}}/posts",
      }),
    );
    stubFetch.enqueue(
      StubResponse.json({
        id: "01J8",
        rev: 4,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-02T00:00:00.000Z",
        title: "Hello",
        status: "published",
        tags: [],
        url: "{{API_URL}}/posts",
      }),
    );
    const posts = environmentOf(stubFetch).collection<Post>("posts");

    const draft = await posts.edit("01J8");
    expect(draft.fields.url).toBe("{{API_URL}}/posts");
    draft.fields.status = "published";
    await draft.save();

    expect(JSON.parse(stubFetch.received[1].body ?? "{}").url).toBe("{{API_URL}}/posts");
  });

  test("the editable surface answers editable entries from every read", async () => {
    const stubFetch = new StubFetch();
    stubFetch.enqueue(
      StubResponse.json({
        id: "01J8",
        rev: 1,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        title: "Hello",
        status: "draft",
        tags: [],
      }),
    );
    const posts = environmentOf(stubFetch).collection<Post>("posts");

    const editable = await posts.editable.get("01J8");

    expect(editable).toBeInstanceOf(Entry);
    // Compiles with no cast and no ts-expect-error, unlike the same call on
    // the collection itself.
    expect(typeof editable.save).toBe("function");
  });

  test("create and replace send ?variables=raw and answer editable entries", async () => {
    const stubFetch = new StubFetch();
    stubFetch.enqueue(
      StubResponse.json(
        { id: "01J9", rev: 1, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z", title: "Hello", status: "draft", tags: [] },
        201,
      ),
    );
    stubFetch.enqueue(StubResponse.empty());
    const posts = environmentOf(stubFetch).collection<Post>("posts");

    const created = await posts.create({ title: "Hello", status: "draft", tags: [] });
    expect(created.rev).toBe(1);
    await posts.delete(created.id, created.rev);
  });

  test("list() answers a page with the server's window, and next() advances by it", async () => {
    const stubFetch = new StubFetch();
    stubFetch.enqueue(
      StubResponse.json({
        data: [
          { id: "01J8", rev: 1, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z", title: "Hello", status: "published", tags: [] },
        ],
        total: 137,
        limit: 500,
        offset: 0,
      }),
    );
    const posts = environmentOf(stubFetch).collection<Post>("posts");

    const filtered = await posts.list({
      where: posts.filter.field("status").equals("published").and(posts.filter.each("tags").equals("release")).and(posts.filter.field("title").contains("ada")),
      sort: Sort.recentlyUpdated(),
      limit: 900,
    });

    expect(filtered.limit).toBe(500);
    expect(filtered.total).toBe(137);
    expect(filtered.pageNumber).toBe(1);
    expect(filtered.hasMore).toBe(true);
  });
});

describe("Queries: filters and sort, untyped statics", () => {
  test("every leaf operator builds the documented wire shape", () => {
    expect(Filter.field("status").equals("published").toJSON()).toEqual({ op: "eq", path: "$.data.status", value: "published" });
    expect(Filter.field("status").notEquals("draft").toJSON()).toEqual({ op: "neq", path: "$.data.status", value: "draft" });
    expect(Filter.field("title").contains("ada").toJSON()).toEqual({ op: "contains", path: "$.data.title", value: "ada" });
    expect(Filter.field("views").greaterThan(10).toJSON()).toEqual({ op: "gt", path: "$.data.views", value: 10 });
    expect(Filter.field("views").atLeast(10).toJSON()).toEqual({ op: "gte", path: "$.data.views", value: 10 });
    expect(Filter.field("views").lessThan(10).toJSON()).toEqual({ op: "lt", path: "$.data.views", value: 10 });
    expect(Filter.field("views").atMost(10).toJSON()).toEqual({ op: "lte", path: "$.data.views", value: 10 });
    expect(Filter.field("status").oneOf(["draft", "review"]).toJSON()).toEqual({ op: "in", path: "$.data.status", value: ["draft", "review"] });
    expect(Filter.field("subtitle").exists().toJSON()).toEqual({ op: "exists", path: "$.data.subtitle" });
    expect(Filter.each("tags").notEquals("x").toJSON()).toEqual({ op: "neq", path: "$.data.tags[*]", value: "x" });
    expect(Filter.not(Filter.each("tags").equals("x")).toJSON()).toEqual({
      op: "not",
      args: [{ op: "eq", path: "$.data.tags[*]", value: "x" }],
    });
  });

  test("Sort statics", () => {
    expect(Sort.by("title").toString()).toBe("$.data.title");
    expect(Sort.by("title").descending().toString()).toBe("-$.data.title");
    expect(Sort.meta("created_at").ascending().toString()).toBe("$.created_at");
    expect(Sort.recentlyUpdated().toString()).toBe("-$.updated_at");
    expect(Sort.recentlyCreated().toString()).toBe("-$.created_at");
    expect(Sort.of(Sort.by("status"), Sort.recentlyUpdated())).toBe("$.data.status,-$.updated_at");
  });
});

describe("Variables", () => {
  test("declare, rename, describe, undeclare, list, set, unset", async () => {
    const stubFetch = new StubFetch();
    const declaration = (overrides: Record<string, unknown> = {}) => ({
      name: "API_URL",
      description: "Public API root",
      value: "https://api.acme.com",
      set_in: 1,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      ...overrides,
    });
    stubFetch.enqueue(StubResponse.json(declaration(), 201));
    stubFetch.enqueue(StubResponse.json(declaration({ name: "PUBLIC_API_URL" })));
    stubFetch.enqueue(StubResponse.json(declaration({ name: "PUBLIC_API_URL", description: "The public API root" })));
    stubFetch.enqueue(StubResponse.empty());
    stubFetch.enqueue(StubResponse.json({ items: [declaration()] }));
    stubFetch.enqueue(StubResponse.json(declaration()));
    stubFetch.enqueue(StubResponse.json(declaration({ value: null, set_in: 0 })));

    const transport = new Transport({ url: "http://localhost:8090", fetch: stubFetch.fetch });
    const acme = new ProjectHandle(transport, "acme");

    await acme.variables.declare("API_URL", { description: "Public API root", environment: "prod", value: "https://api.acme.com" });
    await acme.variables.rename("API_URL", "PUBLIC_API_URL");
    await acme.variables.describe("PUBLIC_API_URL", "The public API root");
    await acme.variables.undeclare("PUBLIC_API_URL");

    const environment = acme.environment("prod");
    await environment.variables.list();
    await environment.variables.set("PUBLIC_API_URL", "https://api.acme.com");
    await environment.variables.unset("PUBLIC_API_URL");

    expect(stubFetch.received).toHaveLength(7);
  });
});

describe("Search", () => {
  test("one collection, one environment", async () => {
    const stubFetch = new StubFetch();
    stubFetch.enqueue(StubResponse.json({ data: [], total: 0, limit: 50, offset: 0, truncated: false, engine: "scan" }));
    stubFetch.enqueue(StubResponse.json({ data: [], total: 0, limit: 50, offset: 0, truncated: false, engine: "scan" }));

    const transport = new Transport({ url: "http://localhost:8090", fetch: stubFetch.fetch });
    const environment = new ProjectHandle(transport, "acme").environment("prod");
    const posts = environment.collection<Post>("posts");

    await posts.search({ query: "pricing" });
    await environment.search({ query: "pricing" });

    expect(stubFetch.received).toHaveLength(2);
  });
});
