import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { SqliteStore } from "../../src/adapters/storage/sqlite/sqlite-store";
import { SqliteReadWorker } from "../../src/adapters/storage/sqlite/sqlite-read-worker";
import { StorageBusyError } from "../../src/core/errors/storage-busy-error";
import { Scope } from "../../src/core/domain/scope";
import { EntryUtils } from "../../src/core/domain/entry-utils";
import { QueryUtils } from "../../src/core/query/query-utils";
import { MaxFilterLeaves } from "../../src/core/query/query";
import type { Entry } from "../../src/core/domain/entry";

/**
 * Scans run on a second connection in a worker (D81), so a filter over a large
 * collection no longer holds the thread every other request runs on. The
 * 2026-09-18 audit measured one `contains` over 200,000 rows at 0.6 s and a
 * 49-way `or` at 12 s, both synchronous; these cases pin that the loop keeps
 * turning while such a read runs, that a flood is shed rather than queued
 * without end, that a list costs the queue one slot, and that the worker's
 * connection cannot write.
 */
describe("SQLite read worker", () => {
  let tempDir: string;
  let store: SqliteStore;
  const scope = Scope.of("acme", "prod");

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-read-worker-"));
    // Opted in: under `bun test` the thread is off by default (see
    // `SqliteStore.readThreadDefault`), and this file is where it is exercised.
    // Every case here awaits its reads plainly before asserting on them.
    store = await SqliteStore.open(path.join(tempDir, "test.db"), undefined, { readThread: true });
  });

  afterEach(async () => {
    await store.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const seed = async (count: number) => {
    await store.putSchema(scope, "posts", { type: "object" });
    const now = new Date();
    for (let i = 0; i < count; i++) {
      const entry: Entry = {
        id: EntryUtils.newID(),
        project: scope.project,
        env: scope.env,
        collection: "posts",
        rev: 1,
        seq: 0,
        created_at: now,
        updated_at: now,
        data: { title: `post ${i}`, body: "lorem ipsum dolor sit amet ".repeat(30) + i },
      };
      await store.put(entry, { usages: [], search: null });
    }
  };

  test("a list reads through the worker and sees what the main connection wrote", async () => {
    await seed(25);
    const page = await store.list(scope, "posts", QueryUtils.normalizeQuery({ limit: 10 }));
    expect(page.total).toBe(25);
    expect(page.items).toHaveLength(10);

    const filtered = await store.list(
      scope,
      "posts",
      QueryUtils.normalizeQuery({ filter: { op: "contains", path: "$.data.title", value: "post 7" } })
    );
    expect(filtered.total).toBe(1);
    expect(filtered.items[0]!.data.title).toBe("post 7");
  });

  test("the event loop keeps turning while a scan runs", async () => {
    await seed(4000);
    // A heavy filter at the leaf cap, so the scan takes long enough to notice.
    const filter = {
      op: "or",
      args: Array.from({ length: MaxFilterLeaves }, (_, i) => ({
        op: "contains",
        path: "$.data.body",
        value: `needle-${i}`,
      })),
    };

    let ticks = 0;
    let longestGap = 0;
    let last = performance.now();
    const ticker = setInterval(() => {
      const now = performance.now();
      longestGap = Math.max(longestGap, now - last);
      last = now;
      ticks++;
    }, 5);
    const started = performance.now();
    const page = await store.list(scope, "posts", QueryUtils.normalizeQuery({ filter }));
    const took = performance.now() - started;
    clearInterval(ticker);

    expect(page.total).toBe(0);
    // Had the scan run on this thread, no tick could have fired while it ran
    // and the longest gap would be the whole query. It is a small fraction.
    expect(ticks).toBeGreaterThan(0);
    expect(longestGap).toBeLessThan(Math.max(took / 2, 50));
  });

  test("a flood past MaxPending is refused as busy rather than queued", async () => {
    await seed(5);
    const reads = SqliteReadWorker.for(path.join(tempDir, "test.db"))!;
    try {
      const inflight: Promise<unknown>[] = [];
      for (let i = 0; i < SqliteReadWorker.MaxPending; i++) {
        inflight.push(reads.all("SELECT COUNT(*) AS n FROM entries", []));
      }
      // Every slot is taken; the next asks the caller to come back.
      await expect(reads.all("SELECT 1", [])).rejects.toBeInstanceOf(StorageBusyError);
      await Promise.all(inflight);
      // And once the queue drains, reads are accepted again.
      expect(await reads.all("SELECT 1 AS one", [])).toEqual([{ one: 1 }]);
    } finally {
      await reads.close();
    }
  });

  // Every request lists `_keys` to check its key, so a list's cost in slots is
  // how many requests the queue holds at once. Two statements per list shed a
  // burst of 52 admin requests on prod at about half the queue.
  test("a list takes one slot, so a full queue of lists is answered", async () => {
    await seed(5);
    const settled = await Promise.allSettled(
      Array.from({ length: SqliteReadWorker.MaxPending + 1 }, () =>
        store.list(scope, "posts", QueryUtils.normalizeQuery({ limit: 2 }))
      )
    );

    const answered = settled.filter((result) => result.status === "fulfilled");
    const refused = settled.filter((result) => result.status === "rejected");
    expect(answered).toHaveLength(SqliteReadWorker.MaxPending);
    expect(refused).toHaveLength(1);
    expect((refused[0] as PromiseRejectedResult).reason).toBeInstanceOf(StorageBusyError);
    for (const result of answered) {
      const page = (result as PromiseFulfilledResult<{ items: Entry[]; total: number }>).value;
      expect(page.total).toBe(5);
      expect(page.items).toHaveLength(2);
    }
  });

  // The conformance suite pins this on the main connection; here it is the
  // worker that answers, and the recount is the one second statement a list
  // still sends.
  test("a page past the end keeps its total on the worker", async () => {
    await seed(5);
    const past = await store.list(scope, "posts", QueryUtils.normalizeQuery({ limit: 10, offset: 10 }));
    expect(past).toEqual({ items: [], total: 5 });

    const filtered = await store.list(
      scope,
      "posts",
      QueryUtils.normalizeQuery({
        filter: { op: "contains", path: "$.data.title", value: "post 1" },
        sort: [{ path: "$.data.title", desc: true }],
        limit: 10,
        offset: 10,
      })
    );
    expect(filtered).toEqual({ items: [], total: 1 });

    const empty = await store.list(
      scope,
      "posts",
      QueryUtils.normalizeQuery({ filter: { op: "eq", path: "$.data.title", value: "nothing" } })
    );
    expect(empty).toEqual({ items: [], total: 0 });
  });

  test("the worker's connection refuses to write", async () => {
    await seed(1);
    const reads = SqliteReadWorker.for(path.join(tempDir, "test.db"))!;
    try {
      await expect(reads.all("DELETE FROM entries", [])).rejects.toThrow(/readonly|read-only|query_only/i);
      expect((await reads.all("SELECT COUNT(*) AS n FROM entries", []))[0]!.n).toBe(1);
    } finally {
      await reads.close();
    }
  });

  test("an in-memory database has no worker and still answers", () => {
    expect(SqliteReadWorker.for(":memory:")).toBeNull();
  });

  test("a filter may test at most MaxFilterLeaves fields", () => {
    const leaves = (count: number) => ({
      op: "or",
      args: Array.from({ length: count }, () => ({ op: "eq", path: "$.data.title", value: "x" })),
    });
    expect(() => QueryUtils.normalizeQuery({ filter: leaves(MaxFilterLeaves) })).not.toThrow();
    expect(() => QueryUtils.normalizeQuery({ filter: leaves(MaxFilterLeaves + 1) })).toThrow(
      /too many fields/
    );
  });
});
