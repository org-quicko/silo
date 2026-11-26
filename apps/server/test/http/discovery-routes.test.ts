import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import type { Hono } from "hono";
import { SqliteStore } from "../../src/adapters/storage/sqlite/sqlite-store";
import { SiloService } from "../../src/core/services/silo-service";
import { SiloServer } from "../../src/http/server";
import { Logger } from "../../src/logging/logger";
import { McpToolCatalog } from "../../src/mcp";

interface DiscoveryCatalogResponse {
  server: { name: string; version: string };
  endpoint: string;
  transport: {
    type: string;
    method: string;
    stateless: boolean;
    protocol_versions: string[];
    latest_protocol_version: string;
    stdio_bridge: string;
  };
  auth: {
    required: boolean;
    type: string;
    headers: string[];
    notes: string;
  };
  instructions: string;
  tools: {
    name: string;
    title: string;
    description: string;
    inputSchema: Record<string, unknown>;
    annotations: Record<string, unknown>;
  }[];
}

/**
 * Unauthenticated root discovery endpoints (D114): `/openapi.json`,
 * `/mcp`, and `/llms.txt`.
 */
describe("discovery routes (D114)", () => {
  let tempDir: string;
  let store: SqliteStore;
  let service: SiloService;
  let app: Hono;
  let rootKey: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-discovery-test-"));
    store = await SqliteStore.open(path.join(tempDir, "silo.db"));
    service = new SiloService(store, { mediaDir: path.join(tempDir, "media") });
    rootKey = await service.keys.bootstrap();
    app = new SiloServer(service, {
      version: "1.6.3-test",
      authDisabled: false,
      logger: Logger.silent(),
    }).build();
  });

  afterEach(async () => {
    await store.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test("GET /openapi.json serves resources/openapi.json openly without authentication", async () => {
    const response = await app.request("http://silo.test/openapi.json");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cache-control")).toBe("no-cache");

    const served = await response.json();
    const checkedInPath = path.resolve(import.meta.dir, "../../../../resources/openapi.json");
    const checkedIn = JSON.parse(await Bun.file(checkedInPath).text());
    expect(served).toEqual(checkedIn);
    const paths = (served as { paths: Record<string, unknown> }).paths;
    expect(Object.keys(paths)).toContain("/openapi.json");
    expect(Object.keys(paths)).toContain("/mcp");
    expect(Object.keys(paths)).toContain("/llms.txt");
  });

  test("GET /openapi.json ignores an invalid Authorization header", async () => {
    const response = await app.request("http://silo.test/openapi.json", {
      headers: { authorization: "Bearer silo_not_a_real_key" },
    });
    expect(response.status).toBe(200);
  });

  test("GET /mcp openly lists all MCP tools and matches POST /api/mcp tools/list", async () => {
    const response = await app.request("http://silo.test/mcp");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cache-control")).toBe("no-cache");

    const body = (await response.json()) as DiscoveryCatalogResponse;
    expect(body.server).toEqual({ name: "silo", version: "1.6.3-test" });
    expect(body.endpoint).toBe("/api/mcp");
    expect(body.transport).toEqual({
      type: "streamable-http",
      method: "POST",
      stateless: true,
      protocol_versions: ["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"],
      latest_protocol_version: "2025-06-18",
      stdio_bridge: "silo mcp",
    });
    expect(body.auth.required).toBe(true);
    expect(body.auth.type).toBe("api_key");
    expect(body.auth.headers).toEqual(["Authorization: Bearer <key>", "X-Api-Key: <key>"]);
    expect(body.instructions).toContain("whoami");

    const rpcResponse = await app.request("http://silo.test/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${rootKey}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(rpcResponse.status).toBe(200);
    const rpcBody = (await rpcResponse.json()) as { result: { tools: unknown[] } };
    expect(body.tools).toEqual(rpcBody.result.tools as DiscoveryCatalogResponse["tools"]);
    expect(body.tools).toEqual(McpToolCatalog.default().descriptors() as DiscoveryCatalogResponse["tools"]);
    expect(JSON.stringify(body.tools)).not.toContain("media:read");
  });

  test("POST /api/mcp still requires an API key even though GET /mcp is open", async () => {
    const response = await app.request("http://silo.test/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(response.status).toBe(401);
  });

  test("POST /mcp answers 405 pointing callers to POST /api/mcp", async () => {
    const response = await app.request("http://silo.test/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, HEAD");
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("method_not_allowed");
    expect(body.error.message).toContain("POST /api/mcp");
  });

  test("GET /llms.txt documents discovery endpoints, MCP, auth, and HTTP API conventions", async () => {
    const response = await app.request("http://silo.test/llms.txt", {
      headers: {
        "x-forwarded-proto": "https",
        "x-forwarded-host": "cms.example.com",
      },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cache-control")).toBe("no-cache");

    const text = await response.text();
    expect(text).toContain("# silo");
    expect(text).toContain("1.6.3-test");
    expect(text).toContain("https://cms.example.com/openapi.json");
    expect(text).toContain("https://cms.example.com/mcp");
    expect(text).toContain("https://cms.example.com/api/mcp");
    expect(text).toContain("https://cms.example.com/api/health");
    expect(text).toContain("Authorization: Bearer <key>");
    expect(text).toContain("X-Api-Key: <key>");
    expect(text).toContain("If-Match");
    expect(text).toContain("?variables=raw");
    expect(text).toContain("silo mcp --url https://cms.example.com");

    for (const tool of McpToolCatalog.default().all()) {
      expect(text).toContain(`\`${tool.name}\``);
    }
  });

  test("GET /llms.txt falls back to relative paths when forwarded host is malformed", async () => {
    const response = await app.request("http://silo.test/llms.txt", {
      headers: {
        "x-forwarded-proto": "https",
        "x-forwarded-host": "bad host:notaport",
      },
    });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("](/openapi.json)");
    expect(text).toContain("](/mcp)");
    expect(text).toContain("](/api/mcp)");
    expect(text).not.toContain("bad host");
  });

  test("discovery endpoints support cross-origin GET and HEAD and reject mutating methods with 405", async () => {
    const origin = "http://localhost:5173";
    for (const routePath of ["/openapi.json", "/mcp", "/llms.txt"]) {
      const preflight = await app.request(`http://silo.test${routePath}`, {
        method: "OPTIONS",
        headers: { origin, "access-control-request-method": "GET" },
      });
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
      expect(preflight.headers.get("access-control-allow-methods")).toBe("GET,HEAD");

      const getRes = await app.request(`http://silo.test${routePath}`, { headers: { origin } });
      expect(getRes.status).toBe(200);
      expect(getRes.headers.get("access-control-allow-origin")).toBe("*");

      const headRes = await app.request(`http://silo.test${routePath}`, {
        method: "HEAD",
        headers: { origin },
      });
      expect(headRes.status).toBe(200);
      expect(headRes.headers.get("access-control-allow-origin")).toBe("*");
      expect(await headRes.text()).toBe("");

      for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
        const disallowed = await app.request(`http://silo.test${routePath}`, { method });
        expect(disallowed.status).toBe(405);
        expect(disallowed.headers.get("allow")).toBe("GET, HEAD");
        const body = (await disallowed.json()) as { error: { code: string } };
        expect(body.error.code).toBe("method_not_allowed");
      }
    }
  });
});
