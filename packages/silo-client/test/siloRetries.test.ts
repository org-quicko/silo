import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ForbiddenError, NetworkError, RequestAbortedError, Silo, SiloError, TimeoutError } from "../src/index";

describe("Silo collection read retries", () => {
  let respond: (request: Request) => Response | Promise<Response>;
  let server: ReturnType<typeof Bun.serve>;

  beforeEach(() => {
    respond = () => Response.json({ id: "first", rev: 1, title: "Recovered" });
    server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (request) => respond(request) });
  });

  afterEach(() => server.stop(true));

  test("returns the entry when a temporary server failure clears on the third attempt", async () => {
    let failures = 2;
    const requestedAt: number[] = [];
    respond = () => {
      requestedAt.push(performance.now());
      return failures-- > 0
        ? new Response("Temporarily unavailable", { status: 503 })
        : Response.json({ id: "first", rev: 1, title: "Recovered" });
    };
    const posts = new Silo({ url: server.url.toString(), cache: { enabled: true, ttl: 60_000, maxSize: 10 } })
      .scope("acme", "dev").collection("posts");

    expect((await posts.get("first")).title).toBe("Recovered");
    expect(requestedAt[1]! - requestedAt[0]!).toBeGreaterThanOrEqual(180);
    expect(requestedAt[2]! - requestedAt[1]!).toBeGreaterThanOrEqual(380);
    respond = () => new Response("Unavailable again", { status: 503 });
    expect((await posts.get("first")).title).toBe("Recovered");
  });

  test("recovers the same read after socket-close and reset failures", async () => {
    const failures = ["UND_ERR_SOCKET", "ECONNRESET"];
    const posts = new Silo({
      url: server.url.toString(),
      fetch: async (input, init) => {
        const code = failures.shift();
        if (code) throw new TypeError("fetch failed", { cause: Object.assign(new Error("Connection closed"), { code }) });
        return fetch(input, init);
      },
    }).scope("acme", "dev").collection("posts");

    expect((await posts.get("first")).title).toBe("Recovered");
  });

  test("retries an interrupted JSON download without caching the partial response", async () => {
    let interrupted = true;
    const posts = new Silo({
      url: server.url.toString(), cache: { enabled: true, ttl: 60_000, maxSize: 10 },
      fetch: async (input, init) => {
        if (!interrupted) return fetch(input, init);
        interrupted = false;
        return new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"id":"first",'));
            controller.error(new TypeError("terminated", { cause: { code: "UND_ERR_SOCKET" } }));
          },
        }), { headers: { "content-type": "application/json" } });
      },
    }).scope("acme", "dev").collection("posts");

    expect((await posts.get("first")).title).toBe("Recovered");
    respond = () => new Response("No new read should be needed", { status: 503 });
    expect((await posts.get("first")).title).toBe("Recovered");
  });

  test("stops after two retries and preserves the final HTTP failure", async () => {
    let requests = 0;
    respond = () => new Response(`Failure ${++requests}`, { status: 503 });
    const posts = new Silo({ url: server.url.toString() }).scope("acme", "dev").collection("posts");

    const failure = await posts.get("first").catch((caught: unknown) => caught);
    expect(failure).toBeInstanceOf(SiloError);
    expect(failure).toMatchObject({ status: 503, message: "Failure 3" });
    expect(requests).toBe(3);
  });

  test("stops after two retries and retains the final network error as the cause", async () => {
    let requests = 0;
    const cause = Object.assign(new Error("Connection reset"), { code: "ECONNRESET" });
    const failure = new TypeError("fetch failed", { cause });
    const posts = new Silo({
      url: server.url.toString(), fetch: async () => { requests++; throw failure; },
    }).scope("acme", "dev").collection("posts");

    const caught = await posts.get("first").catch((error: unknown) => error);
    expect(caught).toBeInstanceOf(NetworkError);
    expect(caught).toMatchObject({ cause: failure });
    expect(requests).toBe(3);
  });

  test("does not repeat a write even when the server reports a temporary failure", async () => {
    const stored: Array<{ id: string; rev: number; title: string }> = [];
    respond = (request) => {
      if (request.method === "POST") {
        stored.push({ id: String(stored.length + 1), rev: 1, title: "Created before the response failed" });
        return new Response("Response failed after creating the entry", { status: 503 });
      }
      return Response.json({ data: stored, total: stored.length, limit: 50, offset: 0 });
    };
    const posts = new Silo({ url: server.url.toString() }).scope("acme", "dev").collection("posts");

    await expect(posts.create({ title: "Create once" })).rejects.toBeInstanceOf(SiloError);
    expect((await posts.list()).entries).toHaveLength(1);
  });

  test("does not retry authentication failures or cache the refusal", async () => {
    let forbidden = true;
    respond = () => {
      if (!forbidden) return Response.json({ id: "first", rev: 1, title: "Recovered" });
      forbidden = false;
      return new Response("Forbidden", { status: 403 });
    };
    const posts = new Silo({ url: server.url.toString() }).scope("acme", "dev").collection("posts");

    await expect(posts.get("first")).rejects.toBeInstanceOf(ForbiddenError);
    expect((await posts.get("first")).title).toBe("Recovered");
  });

  test("does not retry invalid JSON", async () => {
    let malformed = true;
    respond = () => {
      if (!malformed) return Response.json({ id: "first", rev: 1, title: "Recovered" });
      malformed = false;
      return new Response("{broken", { headers: { "content-type": "application/json" } });
    };
    const posts = new Silo({ url: server.url.toString() }).scope("acme", "dev").collection("posts");

    await expect(posts.get("first")).rejects.toBeInstanceOf(SyntaxError);
    expect((await posts.get("first")).title).toBe("Recovered");
  });

  test("the original deadline interrupts backoff before another request is sent", async () => {
    let requests = 0;
    respond = () => { requests++; return new Response("Unavailable", { status: 503 }); };
    const posts = new Silo({ url: server.url.toString(), timeoutMilliseconds: 50 })
      .scope("acme", "dev").collection("posts");

    await expect(posts.get("first")).rejects.toBeInstanceOf(TimeoutError);
    expect(requests).toBe(1);
  });

  test.each([
    { format: "seconds", header: () => "1" },
    { format: "HTTP date", header: () => new Date(Date.now() + 3000).toUTCString() },
  ])("respects Retry-After as $format within the original deadline", async ({ header }) => {
    let limited = true;
    respond = () => {
      if (!limited) return Response.json({ id: "first", rev: 1, title: "Too early" });
      limited = false;
      return new Response("Rate limited", { status: 429, headers: { "retry-after": header() } });
    };
    const posts = new Silo({ url: server.url.toString(), timeoutMilliseconds: 350 })
      .scope("acme", "dev").collection("posts");

    await expect(posts.get("first")).rejects.toBeInstanceOf(TimeoutError);
  });

  test("caller cancellation interrupts a long retry wait", async () => {
    const controller = new AbortController();
    respond = () => {
      setTimeout(() => controller.abort(), 25);
      return new Response("Unavailable", { status: 503, headers: { "retry-after": "60" } });
    };
    const posts = new Silo({ url: server.url.toString() }).scope("acme", "dev").collection("posts");

    await expect(posts.get("first", { signal: controller.signal })).rejects.toBeInstanceOf(RequestAbortedError);
  }, 2000);

  test("the deadline remains active while reading the response body", async () => {
    const posts = new Silo({
      url: server.url.toString(), timeoutMilliseconds: 50,
      fetch: async (_input, init) => new Response(new ReadableStream({
        start(controller) {
          init?.signal?.addEventListener("abort", () => controller.error(new DOMException("Aborted", "AbortError")), { once: true });
        },
      }), { headers: { "content-type": "application/json" } }),
    }).scope("acme", "dev").collection("posts");

    await expect(posts.get("first")).rejects.toBeInstanceOf(TimeoutError);
  });

  test("does not retry early when Retry-After cannot fit in a timer", async () => {
    let unavailable = true;
    respond = () => {
      if (!unavailable) return Response.json({ id: "first", rev: 1, title: "Too early" });
      unavailable = false;
      return new Response("Unavailable", { status: 503, headers: { "retry-after": "9".repeat(400) } });
    };
    const posts = new Silo({ url: server.url.toString() }).scope("acme", "dev").collection("posts");

    await expect(posts.get("first")).rejects.toBeInstanceOf(SiloError);
  });
});
