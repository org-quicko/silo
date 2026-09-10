import { describe, expect, test } from "bun:test";
import type { EntryContext } from "../../src/entries/entry-base";
import { ResolvedEntry } from "../../src/entries/resolved-entry";
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

describe("ResolvedEntry", () => {
  test("exposes id, rev, timestamps and fields from the payload", () => {
    const stubFetch = new StubFetch();
    const entry = new ResolvedEntry<Post>(context(stubFetch), {
      id: "01J8",
      rev: 3,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-02T00:00:00.000Z",
      title: "Hello",
    });

    expect(entry.id).toBe("01J8");
    expect(entry.rev).toBe(3);
    expect(entry.createdAt).toEqual(new Date("2026-01-01T00:00:00.000Z"));
    expect(entry.updatedAt).toEqual(new Date("2026-01-02T00:00:00.000Z"));
    expect(entry.fields).toEqual({ title: "Hello" });
  });

  test("has no save or refresh at runtime", () => {
    const stubFetch = new StubFetch();
    const entry = new ResolvedEntry<Post>(context(stubFetch), {
      id: "01J8",
      rev: 1,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      title: "Hello",
    });

    expect((entry as unknown as { save?: unknown }).save).toBeUndefined();
    expect((entry as unknown as { refresh?: unknown }).refresh).toBeUndefined();
  });

  test("toJSON answers the flat wire shape", () => {
    const stubFetch = new StubFetch();
    const entry = new ResolvedEntry<Post>(context(stubFetch), {
      id: "01J8",
      rev: 3,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-02T00:00:00.000Z",
      title: "Hello",
      url: "https://api.acme.com/posts",
    });

    expect(entry.toJSON()).toEqual({
      id: "01J8",
      rev: 3,
      title: "Hello",
      url: "https://api.acme.com/posts",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-02T00:00:00.000Z",
    });
  });

  test("delete() sends DELETE with the held rev as ?rev=, needing no content", async () => {
    const stubFetch = new StubFetch();
    stubFetch.enqueue(StubResponse.empty());
    const entry = new ResolvedEntry<Post>(context(stubFetch), {
      id: "01J8 special",
      rev: 5,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      title: "Hello",
    });

    await entry.delete();

    expect(stubFetch.received[0].method).toBe("DELETE");
    expect(stubFetch.received[0].url).toBe(
      "http://localhost:8090/api/projects/acme/envs/prod/collections/posts/01J8%20special?rev=5",
    );
  });
});
