import { describe, test, expect, beforeEach, afterEach, setSystemTime } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { SqliteStore } from "../../../src/adapters/storage/sqlite/sqlite-store";
import { Scope } from "../../../src/core/domain/scope";
import { SystemCollections } from "../../../src/core/domain/system-collections";
import { SiloService } from "../../../src/core/services/silo-service";
import type { Logger } from "../../../src/logging/logger";
import { TrashSweepTimer } from "../../../src/cli/runtime/trash-sweep-timer";

type Line = [level: "info" | "warn", message: string, fields?: Record<string, unknown>];

/**
 * The sweep runs on a timer with nobody watching and counts a receipt it could
 * not purge instead of throwing, so its log line is the only report of one
 * that is stuck (D113).
 */
describe("TrashSweepTimer", () => {
  let tempDir: string;
  let store: SqliteStore;
  let service: SiloService;
  let lines: Line[];
  const logger: Pick<Logger, "info" | "warn"> = {
    info: (message, fields) => void lines.push(["info", message, fields]),
    warn: (message, fields) => void lines.push(["warn", message, fields]),
  };

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-trash-sweep-test-"));
    store = await SqliteStore.open(path.join(tempDir, "test.db"));
    service = new SiloService(store, { mediaDir: path.join(tempDir, "media") });
    lines = [];
    await service.collections.putSchema(Scope.Default, "posts", {
      type: "object",
      properties: { title: { type: "string" } },
    });
  });

  afterEach(async () => {
    await store.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  /** An entry deleted long enough ago that its receipt has expired. */
  const trashExpired = async (title: string) => {
    setSystemTime(new Date(Date.now() - 40 * 86_400_000));
    try {
      const entry = await service.entries.create(Scope.Default, "posts", { title });
      await service.entries.delete(Scope.Default, "posts", entry.id, entry.rev);
    } finally {
      setSystemTime();
    }
  };

  test("a receipt that will not purge is logged as a warning", async () => {
    // Two expired receipts, and the store refuses the first item delete it is
    // asked for: one receipt purges, the other is stuck in `purging`.
    await trashExpired("one");
    await trashExpired("two");
    const originalDelete = store.delete.bind(store);
    let failures = 0;
    store.delete = async (scope, collection, id) => {
      if (collection === SystemCollections.TrashItems && failures++ === 0) {
        throw new Error("store refused the delete");
      }
      return originalDelete(scope, collection, id);
    };

    try {
      await TrashSweepTimer.runOnce(service.trash, logger);
    } finally {
      store.delete = originalDelete;
    }

    expect(lines).toEqual([
      ["info", "purged expired trash", { count: 1 }],
      ["warn", "expired trash could not be purged; the next sweep tries again", { count: 1 }],
    ]);
  });
});
