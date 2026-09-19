import { describe, test, expect } from "bun:test";
import { McpStdioBridge } from "../../src/mcp/mcp-stdio-bridge";

interface Seen {
  url: string;
  headers: Record<string, string>;
  body: string;
}

/** A bridge over a fake `fetch`, so the wire behaviour is pinned without a server. */
function bridge(answer: (seen: Seen) => Response) {
  const seen: Seen[] = [];
  const out: string[] = [];
  const warnings: string[] = [];
  const instance = new McpStdioBridge({
    endpoint: "http://silo.test/api/mcp",
    key: "silo_secret",
    write: (line) => out.push(line),
    warn: (message) => warnings.push(message),
    fetch: (async (url: string | URL | Request, init?: RequestInit) => {
      const record: Seen = {
        url: String(url),
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
        body: String(init?.body ?? ""),
      };
      seen.push(record);
      return answer(record);
    }) as typeof fetch,
  });
  return { instance, seen, out, warnings };
}

async function* lines(...chunks: string[]): AsyncGenerator<string> {
  for (const chunk of chunks) yield chunk;
}

describe("silo mcp (stdio bridge)", () => {
  test("endpointOf accepts a base URL with or without the path", () => {
    expect(McpStdioBridge.endpointOf("http://h:8090")).toBe("http://h:8090/api/mcp");
    expect(McpStdioBridge.endpointOf("http://h:8090/")).toBe("http://h:8090/api/mcp");
    expect(McpStdioBridge.endpointOf("https://h/api/mcp")).toBe("https://h/api/mcp");
  });

  test("forwards a request with the key and writes the reply on one line", async () => {
    const { instance, seen, out } = bridge(() =>
      Response.json({ jsonrpc: "2.0", id: 1, result: { tools: [] } })
    );
    await instance.forward('{"jsonrpc":"2.0","id":1,"method":"tools/list"}');

    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe("http://silo.test/api/mcp");
    expect(seen[0].headers.authorization).toBe("Bearer silo_secret");
    expect(seen[0].headers["content-type"]).toBe("application/json");
    expect(seen[0].body).toBe('{"jsonrpc":"2.0","id":1,"method":"tools/list"}');
    expect(out).toEqual(['{"jsonrpc":"2.0","id":1,"result":{"tools":[]}}']);
  });

  test("a notification's 202 produces no output", async () => {
    const { instance, out, warnings } = bridge(() => new Response(null, { status: 202 }));
    await instance.forward('{"jsonrpc":"2.0","method":"notifications/initialized"}');
    expect(out).toEqual([]);
    expect(warnings).toEqual([]);
  });

  test("an HTTP refusal becomes a JSON-RPC error for the request it answers", async () => {
    const { instance, out } = bridge(() =>
      Response.json({ error: { code: "unauthorized", message: "invalid API key" } }, { status: 401 })
    );
    await instance.forward('{"jsonrpc":"2.0","id":"a","method":"tools/list"}');

    expect(out).toHaveLength(1);
    const reply = JSON.parse(out[0]) as { id: string; error: { code: number; message: string } };
    expect(reply.id).toBe("a");
    expect(reply.error.code).toBe(-32000);
    expect(reply.error.message).toContain("401");
    expect(reply.error.message).toContain("invalid API key");
  });

  test("a refused notification is only warned about, never written to stdout", async () => {
    const { instance, out, warnings } = bridge(() => new Response("nope", { status: 403 }));
    await instance.forward('{"jsonrpc":"2.0","method":"notifications/cancelled"}');
    expect(out).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("403");
  });

  test("a network failure is reported the same way and does not throw", async () => {
    const { instance, out } = bridge(() => {
      throw new Error("ECONNREFUSED");
    });
    await instance.forward('{"jsonrpc":"2.0","id":7,"method":"ping"}');
    const reply = JSON.parse(out[0]) as { id: number; error: { message: string } };
    expect(reply.id).toBe(7);
    expect(reply.error.message).toContain("ECONNREFUSED");
  });

  test("pump splits chunks into lines and forwards each, including a final unterminated one", async () => {
    const { instance, seen, out } = bridge((record) => {
      const id = (JSON.parse(record.body) as { id: number }).id;
      return Response.json({ jsonrpc: "2.0", id, result: {} });
    });
    await instance.pump(
      lines('{"jsonrpc":"2.0","id":1,"method":"ping"}\n{"jsonrpc":"2.0",', '"id":2,"method":"ping"}\n\n{"jsonrpc":"2.0","id":3,"method":"ping"}')
    );
    expect(seen).toHaveLength(3);
    expect(out.map((line) => (JSON.parse(line) as { id: number }).id).sort()).toEqual([1, 2, 3]);
  });

  test("a server parse error (400 with a JSON-RPC body) is passed through", async () => {
    const { instance, out } = bridge(() =>
      Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "body is not JSON" } }, { status: 400 })
    );
    await instance.forward("not json");
    expect(JSON.parse(out[0])).toEqual({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "body is not JSON" } });
  });
});
