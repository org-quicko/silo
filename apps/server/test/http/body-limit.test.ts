import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { Hono } from "hono";
import { SqliteStore } from "../../src/adapters/storage/sqlite/sqlite-store";
import { SiloService } from "../../src/core/services/silo-service";
import { SiloServer } from "../../src/http/server";
import { BodyLimitMiddleware } from "../../src/http/middleware/body-limit-middleware";
import { Logger } from "../../src/logging/logger";
import { HttpDefaults } from "../../src/config/http-defaults";

interface ErrorBody {
  error: { code: string; message: string };
}

/**
 * The per-route body ceilings (§10.4). A JSON route refuses an oversize body
 * from its headers, before any handler runs and before auth has a say; the
 * upload routes are exempt here because the listener's own cap bounds them and
 * they stream or spool what they are sent.
 *
 * The JSON ceiling is set to one kilobyte so the cases can send real bodies
 * rather than forging a `Content-Length` the runtime would recompute.
 */
describe("request body ceilings", () => {
  let tempDir: string;
  let store: SqliteStore;
  let service: SiloService;
  let app: Hono;
  const kilobyte = 1 / 1024;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-body-limit-"));
    store = await SqliteStore.open(path.join(tempDir, "test.db"));
    service = new SiloService(store, { mediaDir: path.join(tempDir, "media") });
    await service.keys.bootstrap();
    app = new SiloServer(service, {
      version: "test",
      authDisabled: false,
      logger: Logger.silent(),
      http: {
        idle_timeout: HttpDefaults.IdleTimeout,
        max_body_size_mb: HttpDefaults.MaxBodySizeMb,
        max_json_body_size_mb: kilobyte,
      },
    }).build();
  });

  afterEach(async () => {
    await store.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  /** A body of exactly `bytes` bytes; the ceiling is what is under test, not the parse. */
  const json = (bytes: number): string => `{${" ".repeat(bytes - 2)}}`;

  test("a JSON route refuses an oversize body with 413 before auth runs", async () => {
    // No key: were the body read first, this would be a 401. The 413 shows the
    // refusal came from the headers, ahead of everything else.
    const response = await app.request("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: json(2048),
    });
    expect(response.status).toBe(413);
    const body = (await response.json()) as ErrorBody;
    expect(body.error.code).toBe("payload_too_large");
    expect(body.error.message).toContain("MB");
  });

  test("a chunked body with no length is counted and refused the same way", async () => {
    const chunk = new TextEncoder().encode(" ".repeat(512));
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= 4) return controller.close();
        controller.enqueue(chunk);
        sent++;
      },
    });
    const response = await app.request("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: stream,
      duplex: "half",
    });
    expect(response.status).toBe(413);
  });

  test("a body under the ceiling reaches the route, which then asks for a key", async () => {
    const response = await app.request("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "acme" }),
    });
    // `requireKey` runs before the body is parsed, so an anonymous caller is
    // turned away without the server reading what it sent.
    expect(response.status).toBe(401);
  });

  test("the upload routes are exempt from the JSON ceiling", async () => {
    const big = "a".repeat(4096);
    for (const route of ["/api/media", "/api/media/01ABC/content", "/api/import", "/api/plugins/install"]) {
      const response = await app.request(route, {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: big,
      });
      // Anonymous, so the claim check answers — never the body ceiling.
      expect(response.status).toBe(401);
    }
  });

  test("the classifier names exactly the upload routes", () => {
    expect(BodyLimitMiddleware.isUpload("POST", "/api/media")).toBe(true);
    expect(BodyLimitMiddleware.isUpload("POST", "/api/media/01ABC/content")).toBe(true);
    expect(BodyLimitMiddleware.isUpload("POST", "/api/import")).toBe(true);
    expect(BodyLimitMiddleware.isUpload("POST", "/api/plugins/install")).toBe(true);
    expect(BodyLimitMiddleware.isUpload("PUT", "/api/ext/mirror/anything")).toBe(true);

    expect(BodyLimitMiddleware.isUpload("POST", "/api/media/delete")).toBe(false);
    expect(BodyLimitMiddleware.isUpload("PATCH", "/api/media/01ABC")).toBe(false);
    expect(BodyLimitMiddleware.isUpload("POST", "/api/copy")).toBe(false);
    expect(BodyLimitMiddleware.isUpload("POST", "/api/projects")).toBe(false);
    expect(BodyLimitMiddleware.isUpload("POST", "/api/keys")).toBe(false);
  });
});
