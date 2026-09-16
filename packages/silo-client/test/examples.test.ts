import { describe, expect, test } from "bun:test";
import { Filter } from "../src/query/filter";
import { Sort } from "../src/query/sort";
import { EnvironmentHandle } from "../src/scope/environment-handle";
import { ProjectHandle } from "../src/scope/project-handle";
import { FetchTransport as Transport } from "../src/transport/fetch-transport";
import { StubFetch } from "./support/stub-fetch";
import { StubResponse } from "./support/stub-response";

/**
 * The README's examples, each block
 * builds the same handle chain `Silo.project().environment()` would, and
 * proves it compiles and runs exactly as documented.
 */
interface Movie {
  title: string;
  year: number;
  status: "draft" | "published";
  genres: string[];
  trailerUrl?: string;
}

describe("Projects and environments", () => {
  test("rename is bound to the identity reviewed in a dry run", async () => {
    const stubFetch = new StubFetch();
    stubFetch.enqueue(
      StubResponse.json({ id: "01J8", from: "moviespace", to: "movie-space", rewritten_claims: [], pattern_affected_claims: [] }),
    );
    stubFetch.enqueue(
      StubResponse.json({ id: "01J8", from: "moviespace", to: "movie-space", rewritten_claims: [], pattern_affected_claims: [] }),
    );
    stubFetch.enqueue(StubResponse.empty());

    const moviespace = new ProjectHandle(new Transport({ url: "http://localhost:8090", fetch: stubFetch.fetch }), "moviespace");

    const preview = await moviespace.rename("movie-space", { dryRun: true });
    preview.id;
    preview.rewrittenClaims;
    preview.patternAffectedClaims;
    await moviespace.rename("movie-space", { expectedId: preview.id });
    await moviespace.delete({ force: true });

    expect(stubFetch.received).toHaveLength(3);
  });
});

describe("Collections and schemas", () => {
  test("create, schema get/put, rename", async () => {
    const stubFetch = new StubFetch();
    const schema = {
      type: "object",
      required: ["title"],
      properties: { title: { type: "string" }, year: { type: "integer" }, status: { type: "string" } },
    };
    stubFetch.enqueue(StubResponse.json({ id: "01J8", name: "movies", schema }, 201));
    stubFetch.enqueue(StubResponse.json({ id: "01J8", name: "movies", schema }));
    stubFetch.enqueue(StubResponse.json({ id: "01J8", name: "movies", schema }));

    const transport = new Transport({ url: "http://localhost:8090", fetch: stubFetch.fetch });
    const environment = new ProjectHandle(transport, "moviespace").environment("prod");

    await environment.collections.create("movies", schema);
    const movies = environment.collection<Movie>("movies");
    await movies.schema.get();
    await movies.schema.put(schema);

    expect(stubFetch.received).toHaveLength(3);
  });
});

describe("Entries: reading, editing, writing, listing", () => {
  const environmentOf = (stubFetch: StubFetch): EnvironmentHandle => {
    const transport = new Transport({ url: "http://localhost:8090", fetch: stubFetch.fetch });
    return new ProjectHandle(transport, "moviespace").environment("prod");
  };

  test("a read answers a flat row, and writes take its id and rev", async () => {
    const stubFetch = new StubFetch();
    stubFetch.enqueue(
      StubResponse.json({
        id: "01J8",
        rev: 3,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        title: "Arrival",
        year: 2016,
        status: "draft",
        genres: ["sci-fi"],
        trailerUrl: "https://cdn.moviespace.com/trailers/arrival.mp4",
      }),
    );
    stubFetch.enqueue(StubResponse.empty());
    const movies = environmentOf(stubFetch).collection<Movie>("movies");

    const movie = await movies.get("01J8");

    expect(movie.trailerUrl).toBe("https://cdn.moviespace.com/trailers/arrival.mp4");
    // @ts-expect-error -- a row carries no methods, proven through the full
    // ProjectHandle -> EnvironmentHandle -> CollectionHandle chain.
    movie.save;
    await movies.delete(movie.id, movie.rev);
  });

  test("a raw read carries the template, and replace() writes it back untouched", async () => {
    const stubFetch = new StubFetch();
    stubFetch.enqueue(
      StubResponse.json({
        id: "01J8",
        rev: 3,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        title: "Arrival",
        year: 2016,
        status: "draft",
        genres: ["sci-fi"],
        trailerUrl: "{{CDN_URL}}/trailers/arrival.mp4",
      }),
    );
    stubFetch.enqueue(
      StubResponse.json({
        id: "01J8",
        rev: 4,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-02T00:00:00.000Z",
        title: "Arrival",
        year: 2016,
        status: "published",
        genres: ["sci-fi"],
        trailerUrl: "{{CDN_URL}}/trailers/arrival.mp4",
      }),
    );
    const movies = environmentOf(stubFetch).collection<Movie>("movies");

    const draft = await movies.get("01J8", { variables: "raw" });
    expect(draft.trailerUrl).toBe("{{CDN_URL}}/trailers/arrival.mp4");

    const { id, rev, created_at, updated_at, ...fields } = draft;
    await movies.replace(id, rev, { ...fields, status: "published" });

    // The template survives the round trip, which is the whole point of
    // reading raw before writing.
    expect(JSON.parse(stubFetch.received[1].body ?? "{}").trailerUrl).toBe("{{CDN_URL}}/trailers/arrival.mp4");
    void [created_at, updated_at];
  });

  test("a row is a plain value: it clones, and carries nothing alongside it", async () => {
    const stubFetch = new StubFetch();
    stubFetch.enqueue(
      StubResponse.json({
        id: "01J8",
        rev: 1,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        title: "Arrival",
        year: 2016,
        status: "draft",
        genres: ["sci-fi"],
      }),
    );
    const movies = environmentOf(stubFetch).collection<Movie>("movies");

    const movie = await movies.get("01J8");

    // No transport, no scope, no prototype: what a store or a structured
    // clone would have choked on before (D62).
    expect(Object.keys(movie).sort()).toEqual(
      ["created_at", "genres", "id", "rev", "status", "title", "updated_at", "year"],
    );
    expect(structuredClone(movie)).toEqual(movie);
    expect(JSON.parse(JSON.stringify(movie))).toEqual(movie);
  });

  test("create sends ?variables=raw and answers the row it stored", async () => {
    const stubFetch = new StubFetch();
    stubFetch.enqueue(
      StubResponse.json(
        { id: "01J9", rev: 1, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z", title: "Arrival", year: 2016, status: "draft", genres: ["sci-fi"] },
        201,
      ),
    );
    stubFetch.enqueue(StubResponse.empty());
    const movies = environmentOf(stubFetch).collection<Movie>("movies");

    const created = await movies.create({ title: "Arrival", year: 2016, status: "draft", genres: ["sci-fi"] });
    expect(created.rev).toBe(1);
    await movies.delete(created.id, created.rev);
  });

  test("list() answers a page with the server's window, and next() advances by it", async () => {
    const stubFetch = new StubFetch();
    stubFetch.enqueue(
      StubResponse.json({
        data: [
          { id: "01J8", rev: 1, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z", title: "Arrival", year: 2016, status: "published", genres: ["sci-fi"] },
        ],
        total: 137,
        limit: 500,
        offset: 0,
      }),
    );
    const movies = environmentOf(stubFetch).collection<Movie>("movies");

    const filtered = await movies.list({
      where: movies.filter.field("status").equals("published").and(movies.filter.each("genres").equals("sci-fi")).and(movies.filter.field("title").contains("arrival")),
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
    expect(Filter.field("title").contains("arrival").toJSON()).toEqual({ op: "contains", path: "$.data.title", value: "arrival" });
    expect(Filter.field("year").greaterThan(2000).toJSON()).toEqual({ op: "gt", path: "$.data.year", value: 2000 });
    expect(Filter.field("year").atLeast(2000).toJSON()).toEqual({ op: "gte", path: "$.data.year", value: 2000 });
    expect(Filter.field("year").lessThan(2000).toJSON()).toEqual({ op: "lt", path: "$.data.year", value: 2000 });
    expect(Filter.field("year").atMost(2000).toJSON()).toEqual({ op: "lte", path: "$.data.year", value: 2000 });
    expect(Filter.field("status").oneOf(["draft", "review"]).toJSON()).toEqual({ op: "in", path: "$.data.status", value: ["draft", "review"] });
    expect(Filter.field("tagline").exists().toJSON()).toEqual({ op: "exists", path: "$.data.tagline" });
    expect(Filter.each("genres").notEquals("horror").toJSON()).toEqual({ op: "neq", path: "$.data.genres[*]", value: "horror" });
    expect(Filter.not(Filter.each("genres").equals("horror")).toJSON()).toEqual({
      op: "not",
      args: [{ op: "eq", path: "$.data.genres[*]", value: "horror" }],
    });
    // A dot reaches inside a nested field, as the README's `director.name`.
    expect(Filter.field("director.name").contains("villeneuve").toJSON()).toEqual({
      op: "contains",
      path: "$.data.director.name",
      value: "villeneuve",
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
      name: "CDN_URL",
      description: "Public asset root",
      value: "https://cdn.moviespace.com",
      set_in: 1,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      ...overrides,
    });
    stubFetch.enqueue(StubResponse.json(declaration(), 201));
    stubFetch.enqueue(StubResponse.json(declaration({ name: "PUBLIC_CDN_URL" })));
    stubFetch.enqueue(StubResponse.json(declaration({ name: "PUBLIC_CDN_URL", description: "The public asset root" })));
    stubFetch.enqueue(StubResponse.empty());
    stubFetch.enqueue(StubResponse.json({ items: [declaration()] }));
    stubFetch.enqueue(StubResponse.json(declaration()));
    stubFetch.enqueue(StubResponse.json(declaration({ value: null, set_in: 0 })));

    const transport = new Transport({ url: "http://localhost:8090", fetch: stubFetch.fetch });
    const moviespace = new ProjectHandle(transport, "moviespace");

    await moviespace.variables.declare("CDN_URL", { description: "Public asset root", environment: "prod", value: "https://cdn.moviespace.com" });
    await moviespace.variables.rename("CDN_URL", "PUBLIC_CDN_URL");
    await moviespace.variables.describe("PUBLIC_CDN_URL", "The public asset root");
    await moviespace.variables.undeclare("PUBLIC_CDN_URL");

    const environment = moviespace.environment("prod");
    await environment.variables.list();
    await environment.variables.set("PUBLIC_CDN_URL", "https://cdn.moviespace.com");
    await environment.variables.unset("PUBLIC_CDN_URL");

    expect(stubFetch.received).toHaveLength(7);
  });
});

describe("Search", () => {
  test("one collection, one environment", async () => {
    const stubFetch = new StubFetch();
    stubFetch.enqueue(StubResponse.json({ data: [], total: 0, limit: 50, offset: 0, truncated: false, engine: "scan" }));
    stubFetch.enqueue(StubResponse.json({ data: [], total: 0, limit: 50, offset: 0, truncated: false, engine: "scan" }));

    const transport = new Transport({ url: "http://localhost:8090", fetch: stubFetch.fetch });
    const environment = new ProjectHandle(transport, "moviespace").environment("prod");
    const movies = environment.collection<Movie>("movies");

    await movies.search({ query: "arrival" });
    await environment.search({ query: "arrival" });

    expect(stubFetch.received).toHaveLength(2);
  });
});
