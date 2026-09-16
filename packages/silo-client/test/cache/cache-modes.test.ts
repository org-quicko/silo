import { describe, expect, test } from "bun:test";
import { SiloCache } from "../../src/cache/silo-cache";
import { Silo } from "../../src/silo";
import { FetchTransport } from "../../src/transport/fetch-transport";
import { StubFetch } from "../support/stub-fetch";
import { StubResponse } from "../support/stub-response";

const asset = (filename: string) => ({
  id: "01J8", filename, folder: "", blob_key: filename, size: 1, content_type: "image/png", hash: "hash",
  state: "active", tags: [], url: `http://localhost:8090/media/${filename}`, usage_count: 0,
  created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
});

describe("cache transport and media modes", () => {
  test("health and pass-through GET transport methods do not evict JSON entries", async () => {
    const stub = new StubFetch();
    stub.enqueue(StubResponse.json({ items: [] }));
    stub.enqueue(StubResponse.empty());
    stub.enqueue(new Response(new ReadableStream()));
    stub.enqueue(StubResponse.json({ status: "ok", version: "1" }));
    stub.enqueue(StubResponse.json({ status: "ok", version: "1" }));
    const cache = new SiloCache({ ttlMilliseconds: 1_000 });
    const client = new Silo({ url: "http://localhost:8090", cache, fetch: stub.fetch });
    const transport = cache.wrap(new FetchTransport({ url: "http://localhost:8090", fetch: stub.fetch }));

    await client.projects.list();
    await transport.empty({ method: "GET", path: "/api/empty" });
    await transport.stream({ method: "GET", path: "/api/stream" });
    await client.projects.list();
    await client.health();
    await client.health();
    expect(stub.received).toHaveLength(5);
  });

  test("non-GET transport paths invalidate stored responses", async () => {
    const actions: Array<{
      response: Response;
      dispatch: (transport: ReturnType<SiloCache["wrap"]>) => Promise<unknown>;
      rejects: boolean;
    }> = [
      {
        response: new Response(JSON.stringify({ code: "internal", message: "failed" }), { status: 500 }),
        dispatch: (transport) => transport.empty({ method: "DELETE", path: "/api/item" }),
        rejects: true,
      },
      {
        response: new Response(new ReadableStream()),
        dispatch: (transport) => transport.stream({ method: "POST", path: "/api/export" }),
        rejects: false,
      },
      {
        response: Response.json({ id: "uploaded" }),
        dispatch: (transport) => transport.upload({ method: "POST", path: "/api/media" }, new FormData()),
        rejects: false,
      },
    ];
    for (const action of actions) {
      const responses = [Response.json({ value: "old" }), action.response, Response.json({ value: "new" })];
      const cache = new SiloCache({ ttlMilliseconds: 1_000 });
      const transport = cache.wrap(new FetchTransport({
        url: "http://localhost:8090",
        fetch: async () => responses.shift() ?? new Response("missing", { status: 500 }),
      }));
      await transport.json({ method: "GET", path: "/api/value" });
      if (action.rejects) await expect(action.dispatch(transport)).rejects.toThrow();
      else await action.dispatch(transport);
      expect(await transport.json<{ value: string }>({ method: "GET", path: "/api/value" })).toEqual({ value: "new" });
    }
  });

  test("a decoded undefined JSON response is a cache hit, not a miss", async () => {
    const stub = new StubFetch();
    stub.enqueue(StubResponse.empty());
    const cache = new SiloCache({ ttlMilliseconds: 1_000 });
    const transport = cache.wrap(new FetchTransport({ url: "http://localhost:8090", fetch: stub.fetch }));

    await transport.json<undefined>({ method: "GET", path: "/api/none" });
    await transport.json<undefined>({ method: "GET", path: "/api/none" });
    expect(stub.received).toHaveLength(1);
  });

  test("media page navigation preserves refresh mode", async () => {
    const stub = new StubFetch();
    stub.enqueue(StubResponse.json({ items: [asset("first.png")], total: 2, limit: 1, offset: 0 }));
    stub.enqueue(StubResponse.json({ items: [asset("second.png")], total: 2, limit: 1, offset: 1 }));
    stub.enqueue(StubResponse.json({ items: [asset("first-again.png")], total: 2, limit: 1, offset: 0 }));
    const client = new Silo({ url: "http://localhost:8090", fetch: stub.fetch, cache: { ttlMilliseconds: 1_000 } });

    const first = await client.media.list({ limit: 1 }, { cache: "refresh" });
    const second = await first.next();
    const previous = await second?.previous();
    expect(previous?.files[0]?.filename).toBe("first-again.png");
    expect(stub.received).toHaveLength(3);
  });

  test("media refresh replaces a cached asset and explicit bypass leaves it alone", async () => {
    const stub = new StubFetch();
    stub.enqueue(StubResponse.json(asset("old.png")));
    stub.enqueue(StubResponse.json(asset("fresh.png")));
    stub.enqueue(StubResponse.json(asset("bypass.png")));
    const client = new Silo({ url: "http://localhost:8090", fetch: stub.fetch, cache: { ttlMilliseconds: 1_000 } });

    const file = await client.media.get("01J8");
    await file.refresh();
    expect(file.filename).toBe("fresh.png");
    expect((await client.media.get("01J8")).filename).toBe("fresh.png");
    await file.refresh({ cache: "bypass" });
    expect(file.filename).toBe("bypass.png");
    expect((await client.media.get("01J8")).filename).toBe("fresh.png");
    expect(stub.received).toHaveLength(3);
  });
});
