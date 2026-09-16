import { describe, expect, test } from "bun:test";
import { inspect } from "node:util";
import { RequestAbortedError } from "../../src/errors/request-aborted-error";
import { SiloCache } from "../../src/cache/silo-cache";
import { Silo } from "../../src/silo";
import { StubFetch } from "../support/stub-fetch";
import { StubResponse } from "../support/stub-response";

function client(stub: StubFetch, cache = new SiloCache({ ttlMilliseconds: 1_000 })): Silo {
  return new Silo({ url: "http://localhost:8090", fetch: stub.fetch, cache });
}

describe("cache options and basic modes", () => {
  test("is disabled until configured and rejects every invalid finite bound", () => {
    expect(new SiloCache().enabled).toBe(false);
    for (const ttlMilliseconds of [0, -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => new SiloCache({ ttlMilliseconds })).toThrow(TypeError);
    }
    for (const maxEntries of [0, -1, NaN, -Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => new SiloCache({ ttlMilliseconds: 1, maxEntries })).toThrow(TypeError);
    }
    expect(() => new SiloCache({ ttlMilliseconds: 1, maxEntries: Infinity })).not.toThrow();
    expect(() => new SiloCache({ ttlMilliseconds: "1" as unknown as number })).toThrow(TypeError);
  });

  test("clones storage and every cached hit", async () => {
    const stub = new StubFetch();
    stub.enqueue(StubResponse.json({ items: [{ id: "first" }] }));
    const silo = client(stub);

    const first = await silo.projects.list();
    (first[0] as { id: string }).id = "stored-mutation";
    const hit = await silo.projects.list();
    (hit[0] as { id: string }).id = "hit-mutation";
    expect((await silo.projects.list())[0]?.id).toBe("first");
    expect(stub.received).toHaveLength(1);
  });

  test("expires independently from clone behavior", async () => {
    const stub = new StubFetch();
    stub.enqueue(StubResponse.json({ items: [{ id: "first" }] }));
    stub.enqueue(StubResponse.json({ items: [{ id: "second" }] }));
    const silo = client(stub, new SiloCache({ ttlMilliseconds: 5 }));

    await silo.projects.list();
    await Bun.sleep(10);
    expect((await silo.projects.list())[0]?.id).toBe("second");
  });

  test("bypass neither reads nor stores, refresh replaces only after success, and health always bypasses", async () => {
    const stub = new StubFetch();
    for (const body of ["one", "bypass", "two"]) stub.enqueue(StubResponse.json({ items: [{ id: body }] }));
    stub.enqueue(StubResponse.json({ status: "ok", version: "1" }));
    stub.enqueue(StubResponse.json({ status: "ok", version: "1" }));
    const silo = client(stub);

    expect((await silo.projects.list())[0]?.id).toBe("one");
    expect((await silo.projects.list({ cache: "bypass" }))[0]?.id).toBe("bypass");
    expect((await silo.projects.list())[0]?.id).toBe("one");
    expect((await silo.projects.list({ cache: "refresh" }))[0]?.id).toBe("two");
    await silo.health();
    await silo.health();
    expect(stub.received).toHaveLength(5);
  });

  test("an already aborted cache hit keeps the normal cancellation error", async () => {
    const stub = new StubFetch();
    stub.enqueue(StubResponse.json({ items: [] }));
    const silo = client(stub);
    await silo.projects.list();
    const controller = new AbortController();
    controller.abort();
    await expect(silo.projects.list({ signal: controller.signal })).rejects.toBeInstanceOf(RequestAbortedError);
  });

  test("facade privacy does not expose stored credentials or bodies", async () => {
    const cache = new SiloCache({ ttlMilliseconds: 1_000 });
    const silo = new Silo({ url: "http://localhost:8090", key: "secret-key", cache, fetch: async () => StubResponse.json({ items: [{ id: "secret-body" }] }) });
    await silo.projects.list();
    expect(cache.size).toBe(1);
    expect("store" in cache).toBe(false);
    expect(inspect(cache, { depth: null, showHidden: true })).not.toContain("secret");
    expect(Object.keys(cache)).toEqual([]);
    expect(JSON.stringify(cache)).toBe("{}");
    expect(JSON.stringify(silo.cache)).not.toContain("secret");
    cache.clear();
  });
});
