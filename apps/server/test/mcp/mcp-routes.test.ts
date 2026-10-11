import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { Hono } from "hono";
import { MediaRef } from "@silo/shared/media-ref";
import { SqliteStore } from "../../src/adapters/storage/sqlite/sqlite-store";
import { SiloService } from "../../src/core/services/silo-service";
import { Scope } from "../../src/core/domain/scope";
import { SiloServer } from "../../src/http/server";
import { Logger } from "../../src/logging/logger";
import type { JsonRpcResponse } from "../../src/mcp/json-rpc-message";
import type { McpToolResult } from "../../src/mcp/mcp-tool-result";

interface Entry {
  id: string;
  rev: number;
  title?: string;
}

/**
 * The MCP endpoint end to end: the transport rules (401 without a key, 405 on
 * GET, 202 for a notification, a parse error), the handshake, and tool calls
 * that land on the real routes with the caller's own claims — which is the
 * property the whole design rests on (§8.6).
 */
describe("POST /api/mcp", () => {
  let tempDir: string;
  let store: SqliteStore;
  let service: SiloService;
  let app: Hono;
  let rootKey: string;
  let narrowKey: string;

  const prod = Scope.Default;

  const rpc = async (key: string | null, body: unknown, headers: Record<string, string> = {}) => {
    const init: RequestInit = {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(key ? { authorization: `Bearer ${key}` } : {}),
        ...headers,
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    };
    return app.request("http://silo.test/api/mcp", init);
  };

  const call = async (key: string, name: string, args: Record<string, unknown>, id = 1) => {
    const response = await rpc(key, {
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name, arguments: args },
    });
    expect(response.status).toBe(200);
    return (await response.json()) as JsonRpcResponse;
  };

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-mcp-test-"));
    store = await SqliteStore.open(path.join(tempDir, "silo.db"));
    service = new SiloService(store, { mediaDir: path.join(tempDir, "media") });
    rootKey = await service.keys.bootstrap();
    narrowKey = (
      await service.keys.create("narrow", [
        "collections:default/prod/posts:schema:read",
        "collections:default/prod/posts:entries:read",
      ])
    ).secret;

    await service.scopes.initDefaults("default", "prod");
    await service.collections.putSchema(prod, "posts", {
      type: "object",
      properties: { title: { type: "string" } },
      required: ["title"],
      additionalProperties: false,
    });
    await service.collections.putSchema(prod, "secrets", { type: "object", "x-silo-auth": true });
    await service.entries.create(prod, "posts", { title: "First" });

    app = new SiloServer(service, {
      version: "test",
      authDisabled: false,
      logger: Logger.silent(),
    }).build();
  });

  afterEach(async () => {
    await store.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("transport", () => {
    test("no key is 401 with a WWW-Authenticate challenge", async () => {
      const response = await rpc(null, { jsonrpc: "2.0", id: 1, method: "ping" });
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toBe('Bearer realm="silo"');
    });

    test("a wrong key is 401 from the auth middleware", async () => {
      const response = await rpc("silo_wrong", { jsonrpc: "2.0", id: 1, method: "ping" });
      expect(response.status).toBe(401);
    });

    test("GET and DELETE are 405: there is no stream and no session", async () => {
      for (const method of ["GET", "DELETE"]) {
        const response = await app.request("http://silo.test/api/mcp", {
          method,
          headers: { authorization: `Bearer ${rootKey}` },
        });
        expect(response.status).toBe(405);
        expect(response.headers.get("allow")).toBe("POST");
      }
    });

    test("a body that is not JSON is a -32700 parse error", async () => {
      const response = await rpc(rootKey, "{not json");
      expect(response.status).toBe(400);
      const body = (await response.json()) as JsonRpcResponse;
      expect(body).toEqual({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "body is not JSON" } });
    });

    test("a notification alone is 202 with no body", async () => {
      const response = await rpc(rootKey, { jsonrpc: "2.0", method: "notifications/initialized" });
      expect(response.status).toBe(202);
      expect(await response.text()).toBe("");
    });

    test("something that is not a request is -32600", async () => {
      const response = await rpc(rootKey, { id: 4, hello: "world" });
      const body = (await response.json()) as JsonRpcResponse;
      expect(body.id).toBe(4);
      expect(body.error?.code).toBe(-32600);
    });

    test("a batch answers an array, without the notifications", async () => {
      const response = await rpc(rootKey, [
        { jsonrpc: "2.0", id: 1, method: "ping" },
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { jsonrpc: "2.0", id: 2, method: "ping" },
      ]);
      const body = (await response.json()) as JsonRpcResponse[];
      expect(body.map((reply) => reply.id)).toEqual([1, 2]);
    });

    test("an unknown method is -32601", async () => {
      const response = await rpc(rootKey, { jsonrpc: "2.0", id: 1, method: "resources/list" });
      const body = (await response.json()) as JsonRpcResponse;
      expect(body.error?.code).toBe(-32601);
    });
  });

  describe("handshake", () => {
    test("initialize echoes a known protocol version and names the server", async () => {
      const response = await rpc(rootKey, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "0" } },
      });
      const body = (await response.json()) as JsonRpcResponse;
      const result = body.result as {
        protocolVersion: string;
        capabilities: { tools: object };
        serverInfo: { name: string; version: string };
        instructions: string;
      };
      expect(result.protocolVersion).toBe("2025-03-26");
      expect(result.capabilities.tools).toBeDefined();
      expect(result.serverInfo).toEqual({ name: "silo", version: "test" });
      expect(result.instructions).toContain("whoami");
    });

    test("initialize answers its latest version to one it does not know", async () => {
      const response = await rpc(rootKey, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2031-01-01" },
      });
      const body = (await response.json()) as JsonRpcResponse;
      expect((body.result as { protocolVersion: string }).protocolVersion).toBe("2025-06-18");
    });

    test("ping answers an empty result", async () => {
      const response = await rpc(rootKey, { jsonrpc: "2.0", id: "p", method: "ping" });
      expect((await response.json()) as JsonRpcResponse).toEqual({ jsonrpc: "2.0", id: "p", result: {} });
    });

    test("tools/list is the same catalog whoever asks", async () => {
      const forRoot = await rpc(rootKey, { jsonrpc: "2.0", id: 1, method: "tools/list" });
      const forNarrow = await rpc(narrowKey, { jsonrpc: "2.0", id: 1, method: "tools/list" });
      const rootTools = ((await forRoot.json()) as JsonRpcResponse).result as { tools: { name: string }[] };
      const narrowTools = ((await forNarrow.json()) as JsonRpcResponse).result as { tools: { name: string }[] };
      expect(rootTools.tools.map((tool) => tool.name)).toEqual(narrowTools.tools.map((tool) => tool.name));
      expect(rootTools.tools.map((tool) => tool.name)).toContain("create_entry");
    });
  });

  describe("tools/call", () => {
    test("whoami reports the presented key", async () => {
      const reply = await call(narrowKey, "whoami", {});
      const result = reply.result as McpToolResult;
      expect(result.isError).toBeUndefined();
      expect((result.structuredContent as { label: string }).label).toBe("narrow");
    });

    test("an unknown tool is -32602", async () => {
      const reply = await call(rootKey, "drop_everything", {});
      expect(reply.error?.code).toBe(-32602);
      expect(reply.error?.message).toContain("drop_everything");
    });

    test("arguments off the schema are -32602 naming the field", async () => {
      const reply = await call(rootKey, "get_entry", { project: "default", env: "prod", collection: "posts" });
      expect(reply.error?.code).toBe(-32602);
      expect(reply.error?.message).toContain("id");
    });

    test("list_entries lands on the route and answers the page", async () => {
      const reply = await call(narrowKey, "list_entries", {
        project: "default",
        env: "prod",
        collection: "posts",
        limit: 10,
      });
      const result = reply.result as McpToolResult;
      const page = result.structuredContent as { data: Entry[]; total: number };
      expect(page.total).toBe(1);
      expect(page.data[0].title).toBe("First");
      expect(result.content[0].text).toContain('"First"');
    });

    test("a tool the key lacks the claim for is a tool error naming the claim, not a protocol error", async () => {
      const reply = await call(narrowKey, "create_entry", {
        project: "default",
        env: "prod",
        collection: "posts",
        data: { title: "Nope" },
      });
      expect(reply.error).toBeUndefined();
      const result = reply.result as McpToolResult;
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("forbidden (403)");
      expect(result.content[0].text).toContain("collections:default/prod/posts:entries:create");
    });

    test("a narrow key does not see a collection outside its claims", async () => {
      const reply = await call(narrowKey, "list_collections", { project: "default", env: "prod" });
      const items = (reply.result as McpToolResult).structuredContent as { items: { name: string }[] };
      expect(items.items.map((item) => item.name)).toEqual(["posts"]);
    });

    test("create, update with rev, then delete, through the real validation", async () => {
      const created = (await call(rootKey, "create_entry", {
        project: "default",
        env: "prod",
        collection: "posts",
        data: { title: "Second" },
      })).result as McpToolResult;
      expect(created.isError).toBeUndefined();
      const entry = created.structuredContent as unknown as Entry;
      expect(entry.rev).toBe(1);

      const stale = (await call(rootKey, "update_entry", {
        project: "default",
        env: "prod",
        collection: "posts",
        id: entry.id,
        rev: 9,
        data: { title: "Stale" },
      })).result as McpToolResult;
      expect(stale.isError).toBe(true);
      expect(stale.content[0].text).toContain("conflict (409)");

      const updated = (await call(rootKey, "update_entry", {
        project: "default",
        env: "prod",
        collection: "posts",
        id: entry.id,
        rev: entry.rev,
        data: { title: "Second, revised" },
      })).result as McpToolResult;
      expect((updated.structuredContent as unknown as Entry).rev).toBe(2);

      const invalid = (await call(rootKey, "create_entry", {
        project: "default",
        env: "prod",
        collection: "posts",
        data: { title: 5 },
      })).result as McpToolResult;
      expect(invalid.isError).toBe(true);
      expect(invalid.content[0].text).toContain("validation_failed (400)");

      const deleted = (await call(rootKey, "delete_entry", {
        project: "default",
        env: "prod",
        collection: "posts",
        id: entry.id,
        rev: 2,
      })).result as McpToolResult;
      expect(deleted.structuredContent).toEqual({ ok: true });

      const gone = (await call(rootKey, "get_entry", {
        project: "default",
        env: "prod",
        collection: "posts",
        id: entry.id,
      })).result as McpToolResult;
      expect(gone.isError).toBe(true);
      expect(gone.content[0].text).toContain("not_found (404)");
    });

    test("search reaches the search route at instance scope", async () => {
      const reply = await call(rootKey, "search", { q: "first" });
      const result = reply.result as McpToolResult;
      const page = result.structuredContent as { data: { collection: string }[]; total: number };
      expect(page.total).toBe(1);
      expect(page.data[0].collection).toBe("posts");
    });

    test("create_collection then get_schema round-trips a schema", async () => {
      const created = (await call(rootKey, "create_collection", {
        project: "default",
        env: "prod",
        collection: "tags",
        schema: { type: "object", properties: { name: { type: "string" } } },
      })).result as McpToolResult;
      expect(created.isError).toBeUndefined();

      const schema = (await call(rootKey, "get_schema", {
        project: "default",
        env: "prod",
        collection: "tags",
      })).result as McpToolResult;
      const view = schema.structuredContent as { name: string; schema: { properties: object } };
      expect(view.name).toBe("tags");
      expect(view.schema.properties).toEqual({ name: { type: "string" } });
    });

    test("an entry's media field resolves to a URL rooted where the MCP request arrived", async () => {
      await service.collections.putSchema(prod, "gallery", {
        type: "object",
        properties: { cover: { type: "string", "x-silo-type": "media" } },
      });
      const asset = await service.media.save("dot.png", new Uint8Array([137, 80, 78, 71]));
      const entry = await service.entries.create(prod, "gallery", { cover: MediaRef.url(asset.id) });

      // The same answer a plain GET gives: the host is read off the request,
      // which is what the runner forwards. A plugin's dispatch gets `""` here
      // and the stored reference back; a tool call must not.
      const reply = await call(rootKey, "get_entry", {
        project: "default",
        env: "prod",
        collection: "gallery",
        id: entry.id,
      });
      const view = (reply.result as McpToolResult).structuredContent as { cover: string };
      expect(view.cover).toBe(`http://silo.test/media/${asset.id}`);

      const listed = await call(rootKey, "list_media", {}, 2);
      const items = (listed.result as McpToolResult).structuredContent as { items: { id: string; url: string }[] };
      expect(items.items.map((item) => item.id)).toEqual([asset.id]);
    });
  });
});
