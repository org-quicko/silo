import { describe, expect, test } from "bun:test";
import type { EntryContext } from "../../src/entries/entry-base";
import { Entry } from "../../src/entries/entry";
import { ConflictError } from "../../src/errors/conflict-error";
import { Transport } from "../../src/transport/transport";
import { StubFetch } from "../support/stub-fetch";
import { StubResponse } from "../support/stub-response";

interface Post {
  title: string;
  url?: string;
}

const context = (stubFetch: StubFetch): EntryContext => ({
  transport: new Transport({ url: "http://localhost:8090", fetch: stubFetch.fetch }),
  project: "acme",
  environment: "prod",
  collection: "posts",
});

const entryOf = (stubFetch: StubFetch, fields: Post = { title: "Hello", url: "{{API_URL}}/posts" }): Entry<Post> =>
  new Entry<Post>(context(stubFetch), {
    id: "01J8",
    rev: 3,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...fields,
  });

describe("Entry.save", () => {
  test("sends PUT with the held rev and fields, as ?variables=raw", async () => {
    const stubFetch = new StubFetch();
    stubFetch.enqueue(
      StubResponse.json({
        id: "01J8",
        rev: 4,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-03T00:00:00.000Z",
        title: "Hello",
        url: "{{API_URL}}/posts",
      }),
    );
    const entry = entryOf(stubFetch);

    await entry.save();

    const [request] = stubFetch.received;
    expect(request.method).toBe("PUT");
    expect(request.url).toBe(
      "http://localhost:8090/api/projects/acme/envs/prod/collections/posts/01J8?rev=3&variables=raw",
    );
    expect(JSON.parse(request.body ?? "{}")).toEqual({ title: "Hello", url: "{{API_URL}}/posts" });
  });

  test("adopts the returned rev and timestamps, mutating in place, and returns itself", async () => {
    const stubFetch = new StubFetch();
    stubFetch.enqueue(
      StubResponse.json({
        id: "01J8",
        rev: 4,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-03T00:00:00.000Z",
        title: "Updated",
        url: "{{API_URL}}/posts",
      }),
    );
    const entry = entryOf(stubFetch);

    const result = await entry.save();

    expect(result).toBe(entry);
    expect(entry.rev).toBe(4);
    expect(entry.updatedAt).toEqual(new Date("2026-01-03T00:00:00.000Z"));
    expect(entry.fields.title).toBe("Updated");
  });

  test("preserves a {{...}} template through an edit-then-save round trip", async () => {
    const stubFetch = new StubFetch();
    stubFetch.enqueue(
      StubResponse.json({
        id: "01J8",
        rev: 4,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-02T00:00:00.000Z",
        title: "Hello",
        url: "{{API_URL}}/posts",
      }),
    );
    const entry = entryOf(stubFetch, { title: "Hello", url: "{{API_URL}}/posts" });
    entry.fields.title = "Hello again";

    await entry.save();

    expect(JSON.parse(stubFetch.received[0].body ?? "{}")).toEqual({
      title: "Hello again",
      url: "{{API_URL}}/posts",
    });
  });

  test("refuses a second overlapping save() on the same instance, locally", async () => {
    const stubFetch = new StubFetch();
    const entry = entryOf(stubFetch);
    stubFetch.enqueue(
      StubResponse.json({
        id: "01J8",
        rev: 4,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        title: "Hello",
        url: "{{API_URL}}/posts",
      }),
    );

    const first = entry.save();
    await expect(entry.save()).rejects.toThrow(/save\(\)/);

    await first;
  });

  test("a 409 raises ConflictError, and refresh() afterwards holds the current rev", async () => {
    const stubFetch = new StubFetch();
    const entry = entryOf(stubFetch);
    stubFetch.enqueue(StubResponse.errorBody(409, "conflict", "stale revision"));

    await expect(entry.save()).rejects.toBeInstanceOf(ConflictError);
    expect(entry.rev).toBe(3);

    stubFetch.enqueue(
      StubResponse.json({
        id: "01J8",
        rev: 5,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-04T00:00:00.000Z",
        title: "Someone else's edit",
        url: "{{API_URL}}/posts",
      }),
    );
    await entry.refresh();

    expect(entry.rev).toBe(5);
    expect(entry.fields.title).toBe("Someone else's edit");
    const refreshRequest = stubFetch.received[1];
    expect(refreshRequest.method).toBe("GET");
    expect(refreshRequest.url).toBe(
      "http://localhost:8090/api/projects/acme/envs/prod/collections/posts/01J8?variables=raw",
    );
  });
});
