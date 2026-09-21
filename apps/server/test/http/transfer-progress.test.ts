import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { Hono } from "hono";
import { SqliteStore } from "../../src/adapters/storage/sqlite/sqlite-store";
import { FsBlobStorage } from "../../src/adapters/blob/fs-blob-storage";
import { SiloService } from "../../src/core/services/silo-service";
import { Scope } from "../../src/core/domain/scope";
import { SiloServer } from "../../src/http/server";
import { Logger } from "../../src/logging/logger";
import { ProgressStream } from "../../src/http/routes/progress-stream";
import type { ImportResult } from "../../src/core/transfer/import-result";

interface ProgressLine {
  type: "progress" | "result" | "error";
  phase?: string;
  result?: ImportResult;
  status?: number;
  error?: { code: string; message: string };
}

const lines = async (response: Response): Promise<ProgressLine[]> => {
  const body = await response.text();
  return body
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as ProgressLine);
};

/**
 * The progress stream (§7.8). What it is for is a connection that closes when
 * it goes quiet, which a test cannot reproduce; what it can pin is the contract
 * a client reads — opt-in, line-delimited, and the answer in the last line
 * whether the run succeeded or not.
 */
describe("transfer progress stream", () => {
  let tempDir: string;
  let store: SqliteStore;
  let service: SiloService;
  let app: Hono;
  let key: string;
  let archive: Uint8Array;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-progress-test-"));
    store = await SqliteStore.open(path.join(tempDir, "source.db"));
    service = new SiloService(store, {
      blobStorage: new FsBlobStorage(path.join(tempDir, "media")),
    });
    key = await service.keys.bootstrap();
    app = new SiloServer(service, {
      version: "test",
      authDisabled: false,
      logger: Logger.silent(),
    }).build();

    await service.collections.putSchema(Scope.Default, "posts", { type: "object" });
    await service.entries.create(Scope.Default, "posts", { title: "one" });

    const archivePath = path.join(tempDir, "archive.tar.gz");
    await service.transfer.exportTarGz(archivePath, {});
    archive = new Uint8Array(await fs.readFile(archivePath));
  });

  afterEach(async () => {
    await store.close();
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  const post = (query: string, accept?: string) =>
    app.request(`/api/import${query}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/gzip",
        ...(accept ? { Accept: accept } : {}),
      },
      body: archive,
    });

  test("without the header the response is the ordinary JSON body", async () => {
    const response = await post("?dry_run=true");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(((await response.json()) as ImportResult).dry_run).toBe(true);
  });

  test("with it, the last line carries the result the JSON body would have", async () => {
    const response = await post("?dry_run=true", ProgressStream.ContentType);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain(ProgressStream.ContentType);
    // Buffering this anywhere in front would undo the only thing it is for.
    expect(response.headers.get("X-Accel-Buffering")).toBe("no");

    const parsed = await lines(response);
    const last = parsed[parsed.length - 1]!;
    expect(last.type).toBe("result");
    expect(last.result?.dry_run).toBe(true);
    expect(parsed.some((line) => line.type === "progress")).toBe(true);
  });

  test("a refusal is the last line, not the status", async () => {
    // The status went out before the work began, so it cannot carry this. A
    // caller reads the last line; an unknown mode is a 400 everywhere else.
    const response = await post("?mode=sideways", ProgressStream.ContentType);
    expect(response.status).toBe(200);

    const last = (await lines(response)).pop()!;
    expect(last.type).toBe("error");
    expect(last.status).toBe(400);
    expect(last.error?.message).toContain("sideways");
  });

  test("a progress line and the result describe one run, not two", async () => {
    // Re-importing an instance's own archive: every entry is already there, so
    // merge skips them, which is a counter moving either way.
    const parsed = await lines(await post("", ProgressStream.ContentType));
    const progress = parsed.filter((line) => line.type === "progress" && line.result);
    expect(progress.length).toBeGreaterThan(0);
    expect(progress[0]!.result!.mode).toBe("merge");

    const result = parsed.pop()!.result!;
    expect(result.skipped).toBeGreaterThan(0);
    // The last progress line is a snapshot of the same object the result is
    // built from, so it can never have counted a different import.
    const last = progress[progress.length - 1]!.result!;
    expect(last.skipped).toBe(result.skipped);
    expect(last.added).toBe(result.added);
  });
});
