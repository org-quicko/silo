import { describe, expect, test } from "bun:test";
import { Silo } from "../../src/silo";
import type { FetchFunction } from "../../src/transport/fetch-function";

interface Deferred<Value> {
  promise: Promise<Value>;
  resolve(value: Value): void;
}

function deferred<Value>(): Deferred<Value> {
  let resolve: ((value: Value) => void) | undefined;
  const promise = new Promise<Value>((complete) => { resolve = complete; });
  return { promise, resolve: (value) => resolve?.(value) };
}

function projects(id: string): Response {
  return Response.json({ items: [{ id, name: id }] });
}

describe("cache races and invalidation", () => {
  test("a newer refresh wins when an older GET resolves afterward", async () => {
    const first = deferred<Response>();
    const refresh = deferred<Response>();
    let calls = 0;
    const fetch: FetchFunction = () => {
      calls += 1;
      return calls === 1 ? first.promise : refresh.promise;
    };
    const client = new Silo({ url: "http://localhost:8090", fetch, cache: { ttlMilliseconds: 1_000 } });

    const old = client.projects.list();
    const newRead = client.projects.list({ cache: "refresh" });
    refresh.resolve(projects("new"));
    await newRead;
    first.resolve(projects("old"));
    await old;

    expect((await client.projects.list())[0]?.id).toBe("new");
    expect(calls).toBe(2);
  });

  test("a failed refresh preserves an earlier cached response", async () => {
    let calls = 0;
    const fetch: FetchFunction = async () => {
      calls += 1;
      return calls === 1 ? projects("cached") : new Response("failed", { status: 500 });
    };
    const client = new Silo({ url: "http://localhost:8090", fetch, cache: { ttlMilliseconds: 1_000 } });

    await client.projects.list();
    await expect(client.projects.list({ cache: "refresh" })).rejects.toThrow();
    expect((await client.projects.list())[0]?.id).toBe("cached");
    expect(calls).toBe(2);
  });

  test("a failed newer refresh also prevents an older pending GET from storing", async () => {
    const first = deferred<Response>();
    let calls = 0;
    const fetch: FetchFunction = async () => {
      calls += 1;
      if (calls === 1) return first.promise;
      if (calls === 2) return new Response("failed", { status: 500 });
      return projects("after-failure");
    };
    const client = new Silo({ url: "http://localhost:8090", fetch, cache: { ttlMilliseconds: 1_000 } });

    const old = client.projects.list();
    await expect(client.projects.list({ cache: "refresh" })).rejects.toThrow();
    first.resolve(projects("old"));
    await old;
    expect((await client.projects.list())[0]?.id).toBe("after-failure");
    expect(calls).toBe(3);
  });

  test("a GET started before a write cannot populate after that write", async () => {
    const read = deferred<Response>();
    let calls = 0;
    const fetch: FetchFunction = async (_input, init) => {
      calls += 1;
      if (init?.method === "GET" && calls === 1) return read.promise;
      if (init?.method === "POST") return Response.json({ id: "acme", name: "acme" }, { status: 201 });
      return projects("after");
    };
    const client = new Silo({ url: "http://localhost:8090", fetch, cache: { ttlMilliseconds: 1_000 } });

    const oldRead = client.projects.list();
    await client.projects.create("acme");
    read.resolve(projects("old"));
    await oldRead;
    expect((await client.projects.list())[0]?.id).toBe("after");
    expect(calls).toBe(3);
  });

  test("a read during a pending write cannot survive its settlement", async () => {
    const write = deferred<Response>();
    let calls = 0;
    const fetch: FetchFunction = async (_input, init) => {
      calls += 1;
      if (init?.method === "POST") return write.promise;
      return projects(calls === 2 ? "during" : "after");
    };
    const client = new Silo({ url: "http://localhost:8090", fetch, cache: { ttlMilliseconds: 1_000 } });

    const pendingWrite = client.projects.create("acme");
    expect((await client.projects.list())[0]?.id).toBe("during");
    write.resolve(Response.json({ id: "acme", name: "acme" }, { status: 201 }));
    await pendingWrite;
    expect((await client.projects.list())[0]?.id).toBe("after");
    expect(calls).toBe(3);
  });

  test("a read that finishes after a pending write also cannot survive", async () => {
    const write = deferred<Response>();
    const read = deferred<Response>();
    let calls = 0;
    const fetch: FetchFunction = async (_input, init) => {
      calls += 1;
      if (init?.method === "POST") return write.promise;
      if (calls === 2) return read.promise;
      return projects("after");
    };
    const client = new Silo({ url: "http://localhost:8090", fetch, cache: { ttlMilliseconds: 1_000 } });

    const pendingWrite = client.projects.create("acme");
    const pendingRead = client.projects.list();
    write.resolve(Response.json({ id: "acme", name: "acme" }, { status: 201 }));
    await pendingWrite;
    read.resolve(projects("during"));
    expect((await pendingRead)[0]?.id).toBe("during");
    expect((await client.projects.list())[0]?.id).toBe("after");
    expect(calls).toBe(3);
  });

  test("manual clear also discards a pending read", async () => {
    const first = deferred<Response>();
    let calls = 0;
    const client = new Silo({
      url: "http://localhost:8090", cache: { ttlMilliseconds: 1_000 },
      fetch: async () => ++calls === 1 ? first.promise : projects("after-clear"),
    });
    const pending = client.projects.list();
    client.cache.clear();
    first.resolve(projects("old"));
    await pending;
    expect(client.cache.size).toBe(0);
    expect((await client.projects.list())[0]?.id).toBe("after-clear");
    expect(calls).toBe(2);
    client.cache.clear();
  });

  test("a failed write clears reads cached while it was pending", async () => {
    const write = deferred<Response>();
    let calls = 0;
    const client = new Silo({
      url: "http://localhost:8090", cache: { ttlMilliseconds: 1_000 },
      fetch: async (_input, init) => {
        calls += 1;
        if (init?.method === "POST") return write.promise;
        return projects(calls === 2 ? "during" : "after");
      },
    });
    const pending = client.projects.create("acme");
    await client.projects.list();
    write.resolve(new Response("failure", { status: 500 }));
    await expect(pending).rejects.toThrow();
    expect((await client.projects.list())[0]?.id).toBe("after");
    expect(calls).toBe(3);
    client.cache.clear();
  });

});
