import { describe, expect, test } from "bun:test";
import { NetworkError } from "../../src/errors/network-error";
import { NotFoundError } from "../../src/errors/not-found-error";
import { RequestAbortedError } from "../../src/errors/request-aborted-error";
import { TimeoutError } from "../../src/errors/timeout-error";
import type { FetchFunction } from "../../src/transport/fetch-function";
import { Transport } from "../../src/transport/transport";
import { StubFetch } from "../support/stub-fetch";
import { StubResponse } from "../support/stub-response";

describe("Transport: authorization", () => {
  test("sends Authorization: Bearer <key> when a key is set", async () => {
    const stubFetch = new StubFetch();
    stubFetch.enqueue(StubResponse.json({ status: "ok" }));
    const transport = new Transport({ url: "http://localhost:8090", key: "secret", fetch: stubFetch.fetch });

    await transport.json({ method: "GET", path: "/api/health" });

    expect(stubFetch.received[0].headers["authorization"]).toBe("Bearer secret");
  });

  test("sends no Authorization header when no key is set, for anonymous reads", async () => {
    const stubFetch = new StubFetch();
    stubFetch.enqueue(StubResponse.json({ status: "ok" }));
    const transport = new Transport({ url: "http://localhost:8090", fetch: stubFetch.fetch });

    await transport.json({ method: "GET", path: "/api/health" });

    expect(stubFetch.received[0].headers["authorization"]).toBeUndefined();
  });
});

describe("Transport: base URL normalisation", () => {
  test("strips one or more trailing slashes", async () => {
    const stubFetch = new StubFetch();
    stubFetch.enqueue(StubResponse.json({}));
    stubFetch.enqueue(StubResponse.json({}));

    await new Transport({ url: "http://localhost:8090/", fetch: stubFetch.fetch }).json({
      method: "GET",
      path: "/api/health",
    });
    await new Transport({ url: "http://localhost:8090///", fetch: stubFetch.fetch }).json({
      method: "GET",
      path: "/api/health",
    });

    expect(stubFetch.received[0].url).toBe("http://localhost:8090/api/health");
    expect(stubFetch.received[1].url).toBe("http://localhost:8090/api/health");
  });
});

describe("Transport: request bodies", () => {
  test("JSON-encodes a body and sets Content-Type", async () => {
    const stubFetch = new StubFetch();
    stubFetch.enqueue(StubResponse.json({ id: "1" }, 201));
    const transport = new Transport({ url: "http://localhost:8090", fetch: stubFetch.fetch });

    await transport.json({ method: "POST", path: "/api/projects", body: { id: "acme" } });

    expect(stubFetch.received[0].body).toBe(JSON.stringify({ id: "acme" }));
    expect(stubFetch.received[0].headers["content-type"]).toBe("application/json");
  });

  test("upload never sets Content-Type by hand, so the runtime supplies the multipart boundary", async () => {
    const stubFetch = new StubFetch();
    stubFetch.enqueue(StubResponse.json({ id: "1" }, 201));
    const transport = new Transport({ url: "http://localhost:8090", fetch: stubFetch.fetch });

    const form = new FormData();
    form.set("file", new Blob(["bytes"]), "hero.png");
    await transport.upload({ method: "POST", path: "/api/media" }, form);

    expect(stubFetch.received[0].headers["content-type"]).toBeUndefined();
  });

  test("empty() decodes a 204 to nothing and throws on none", async () => {
    const stubFetch = new StubFetch();
    stubFetch.enqueue(StubResponse.empty());
    const transport = new Transport({ url: "http://localhost:8090", fetch: stubFetch.fetch });

    await expect(transport.empty({ method: "DELETE", path: "/api/media/01J8" })).resolves.toBeUndefined();
  });
});

describe("Transport: derived clients", () => {
  test("withKey shares the fetch function but reads a different key", async () => {
    const stubFetch = new StubFetch();
    stubFetch.enqueue(StubResponse.json({}));
    const original = new Transport({ url: "http://localhost:8090", key: "k1", fetch: stubFetch.fetch });
    const derived = original.withKey("k2");

    await derived.json({ method: "GET", path: "/api/health" });

    expect(stubFetch.received[0].headers["authorization"]).toBe("Bearer k2");
  });

  test("withUrl shares the fetch function but reads a different base URL", async () => {
    const stubFetch = new StubFetch();
    stubFetch.enqueue(StubResponse.json({}));
    const original = new Transport({ url: "http://localhost:8090", fetch: stubFetch.fetch });
    const derived = original.withUrl("https://staging.example.com");

    await derived.json({ method: "GET", path: "/api/health" });

    expect(stubFetch.received[0].url).toBe("https://staging.example.com/api/health");
  });
});

describe("Transport: error mapping", () => {
  test("a non-2xx response is mapped through ErrorFactory", async () => {
    const stubFetch = new StubFetch();
    stubFetch.enqueue(StubResponse.errorBody(404, "not_found", "no such project"));
    const transport = new Transport({ url: "http://localhost:8090", fetch: stubFetch.fetch });

    await expect(transport.json({ method: "GET", path: "/api/projects/nope" })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("Transport: three distinct failure kinds", () => {
  test("a fetch rejection becomes NetworkError", async () => {
    const failingFetch: FetchFunction = async () => {
      throw new TypeError("fetch failed");
    };
    const transport = new Transport({ url: "http://localhost:8090", fetch: failingFetch });

    await expect(transport.json({ method: "GET", path: "/api/health" })).rejects.toBeInstanceOf(NetworkError);
  });

  test("an abort from the deadline becomes TimeoutError, not RequestAbortedError", async () => {
    const transport = new Transport({ url: "http://localhost:8090", fetch: neverSettlingFetch() });

    await expect(
      transport.json({ method: "GET", path: "/api/health", timeoutMilliseconds: 5 }),
    ).rejects.toBeInstanceOf(TimeoutError);
  });

  test("an abort from the caller's own signal becomes RequestAbortedError, not TimeoutError", async () => {
    const transport = new Transport({ url: "http://localhost:8090", fetch: neverSettlingFetch() });
    const controller = new AbortController();

    const pending = transport.json({ method: "GET", path: "/api/health", signal: controller.signal });
    controller.abort();

    await expect(pending).rejects.toBeInstanceOf(RequestAbortedError);
  });
});

/** A fetch that never resolves on its own, but honours the signal it was
 *  given — exactly like a real `fetch` waiting on a slow server. */
const neverSettlingFetch = (): FetchFunction => {
  return (_input, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    });
};
