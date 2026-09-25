import { describe, expect, test } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { PgConnection } from "../../src/adapters/storage/postgres/pg-connection";
import type { PgScanGate } from "../../src/adapters/storage/postgres/pg-scan-gate";
import { PgStore } from "../../src/adapters/storage/postgres/pg-store";
import { PgUnavailableError } from "../../src/adapters/storage/postgres/pg-unavailable-error";
import { SiloRuntime } from "../../src/cli/runtime/silo-runtime";
import { ConfigLoader } from "../../src/config/config-loader";
import type { Entry } from "../../src/core/domain/entry";
import { Scope } from "../../src/core/domain/scope";
import { StorageBusyError } from "../../src/core/errors/storage-busy-error";
import { ProviderRegistry } from "../../src/plugins/registry/provider-registry";
import { AsyncChecks } from "./support/async-checks";
import { PgTestDatabase } from "./support/pg-test-database";

/**
 * What the Postgres adapter does when the database misbehaves (P3): a server
 * that is not there yet, a connection killed under a transaction, a statement
 * over its timeout, a flood of scans, a lost owner lock and a shutdown with
 * work in flight. Each kills or starves real sessions of its own, named by a
 * fresh `application_name`, so no test can disturb another's.
 */
const url = PgTestDatabase.url();

describe("the postgres driver's configuration", () => {
  test("is refused without a URL, naming both ways to give one", async () => {
    const config = ConfigLoader.defaultConfig();
    config.storage.driver = "postgres";
    const message = await AsyncChecks.refusal(ProviderRegistry.withBuiltins().openStorage(config));
    expect(message).toContain("[storage] url");
    expect(message).toContain("SILO_STORAGE_URL");
  });

  test("is a reserved name no plugin can take", () => {
    expect(ProviderRegistry.Reserved).toContain("postgres");
  });
});

if (!url) {
  describe.skip(`Postgres connections (set ${PgTestDatabase.Variable} to run)`, () => {
    test("startup wait, retries, timeouts, scans, owner lock, shutdown", () => {});
  });
} else {
  describe("PgStore startup", () => {
    test("an unreachable server is retried until the wait runs out, then named without its password", async () => {
      const target = new URL(url);
      target.password = "not-for-the-log";
      target.host = "127.0.0.1:1";
      const started = Date.now();
      const message = await AsyncChecks.refusal(
        PgStore.open({ url: target.toString(), schema: PgTestDatabase.freshSchema(), startupWait: 1 })
      );
      const elapsed = Date.now() - started;

      expect(message).toMatch(/could not reach Postgres at 127\.0\.0\.1:1 within 1s/);
      expect(message).not.toContain("not-for-the-log");
      // Backed off twice (250 ms, then 500 ms) before the next wait would pass the deadline.
      expect(elapsed).toBeGreaterThanOrEqual(700);
      expect(elapsed).toBeLessThan(5_000);
    });

    test("a wrong password is refused at once, however long the wait", async () => {
      const target = new URL(url);
      target.password = `wrong-${target.password}`;
      const started = Date.now();
      const message = await AsyncChecks.refusal(
        PgStore.open({ url: target.toString(), schema: PgTestDatabase.freshSchema(), startupWait: 30 })
      );
      expect(message).toMatch(/password authentication failed/);
      expect(Date.now() - started).toBeLessThan(5_000);
    });
  });

  describe("PgConnection retries and timeouts", () => {
    test("a transaction whose connection is killed before it commits runs again", async () => {
      const connection = PgConnection.open({
        url,
        max: 2,
        applicationName: PgTestDatabase.freshApplicationName(),
      });
      try {
        let attempts = 0;
        const answer = await connection.transaction(async (session) => {
          attempts += 1;
          const [me] = await session.query<{ pid: number }>(`SELECT pg_backend_pid() AS pid`);
          if (attempts === 1) {
            await PgTestDatabase.admin((sql) =>
              sql.unsafe(`SELECT pg_terminate_backend($1::int)`, [me.pid])
            );
            await Bun.sleep(100);
          }
          const [row] = await session.query<{ one: number }>(`SELECT 1 AS one`);
          return row.one;
        });
        expect(answer).toBe(1);
        expect(attempts).toBe(2);
        expect(connection.stats().retries).toBe(1);
      } finally {
        await connection.close();
      }
    });

    test("a serialization failure is run again, since the server rolled it back", async () => {
      const connection = PgConnection.open({
        url,
        max: 1,
        applicationName: PgTestDatabase.freshApplicationName(),
      });
      try {
        let attempts = 0;
        await connection.transaction(async (session) => {
          attempts += 1;
          if (attempts === 1) {
            await session.query(
              `DO $$ BEGIN RAISE EXCEPTION 'conflict' USING ERRCODE = '40001'; END $$`
            );
          }
          return null;
        });
        expect(attempts).toBe(2);
      } finally {
        await connection.close();
      }
    });

    test("a read is answered after every pooled connection was killed", async () => {
      const applicationName = PgTestDatabase.freshApplicationName();
      const connection = PgConnection.open({ url, max: 3, applicationName });
      try {
        await Promise.all([1, 2, 3].map(() => connection.query(`SELECT pg_sleep(0.05)`)));
        expect(await PgTestDatabase.kill(applicationName)).toBeGreaterThan(0);
        await Bun.sleep(200);
        const [row] = await connection.query<{ one: number }>(`SELECT 1 AS one`);
        expect(row.one).toBe(1);
      } finally {
        await connection.close();
      }
    });

    test("a statement over the timeout is a retryable 503, not a 500", async () => {
      const connection = PgConnection.open({
        url,
        max: 1,
        applicationName: PgTestDatabase.freshApplicationName(),
        statementTimeout: 0.2,
      });
      try {
        const error = await connection.query(`SELECT pg_sleep(2)`).catch((caught) => caught);
        expect(error).toBeInstanceOf(StorageBusyError);
        expect((error as PgUnavailableError).failure).toBe("busy");
      } finally {
        await connection.close();
      }
    });
  });

  describe("PgConnection close", () => {
    test("work in flight finishes, and work after is refused", async () => {
      const connection = PgConnection.open({
        url,
        max: 2,
        applicationName: PgTestDatabase.freshApplicationName(),
      });
      const slow = connection.query<{ done: boolean }>(`SELECT true AS done FROM pg_sleep(0.3)`);
      await Bun.sleep(50);
      const closing = connection.close(5_000);

      expect((await slow)[0].done).toBe(true);
      await closing;
      expect(await AsyncChecks.refusal(connection.query(`SELECT 1`))).toBe("storage is shutting down");
    });

    test("the grace period is a ceiling, and no session outlives it for long", async () => {
      const applicationName = PgTestDatabase.freshApplicationName();
      const connection = PgConnection.open({ url, max: 1, applicationName, statementTimeout: 1 });
      const slow = connection.query(`SELECT pg_sleep(3)`).then(
        () => "finished",
        () => "cut"
      );
      await Bun.sleep(100);

      const started = Date.now();
      await connection.close(200);
      expect(Date.now() - started).toBeLessThan(2_000);
      expect(await slow).toBe("cut");
      // The server notices the client has gone when the statement ends, which
      // the one-second timeout bounds.
      await AsyncChecks.until(async () => (await PgTestDatabase.sessions(applicationName)) === 0, 5_000, 100);
    });
  });

  describe("PgStore scans", () => {
    test("past the queue a scan is shed as busy, while writes still go through", async () => {
      const store = await PgStore.open({
        url,
        schema: PgTestDatabase.freshSchema(),
        poolSize: 3,
        scanQueue: 1,
      });
      try {
        await store.putSchema(Scope.Default, "posts", { type: "object" });
        // White-box, deliberately: the gate's one slot is held here the way a
        // slow filter would hold it, which no real query does on demand.
        const gate = (store as unknown as { scans: PgScanGate }).scans;
        let release!: () => void;
        const holding = gate.run(() => new Promise<void>((resolve) => (release = resolve)));

        const outcomes = [1, 2].map(() =>
          store.list(Scope.Default, "posts", { limit: 10, offset: 0 }).then(
            (page) => ({ total: page.total }),
            (error) => ({ error })
          )
        );
        await AsyncChecks.until(() => gate.stats().scans_waiting === 1 && gate.stats().shed === 1);

        await store.put(entry("written"), { usages: [], search: null });
        expect((await store.get(Scope.Default, "posts", "written")).id).toBe("written");

        release();
        await holding;
        const settled = await Promise.all(outcomes);
        const shed = settled.filter((outcome) => "error" in outcome);
        expect(shed).toHaveLength(1);
        expect((shed[0] as { error: unknown }).error).toBeInstanceOf(StorageBusyError);
        expect(settled.find((outcome) => "total" in outcome)).toEqual({ total: 1 });

        const measured = await store.measure();
        expect(measured.pool).toMatchObject({ size: 3, shed: 1, scans_waiting: 0 });
        expect(measured.bytes).toBeGreaterThan(0);
        expect(measured.owner).toBe("not_claimed");
      } finally {
        await dispose(store);
      }
    });
  });

  describe("PgStore owner lock", () => {
    test("a lock whose connection is killed is taken back by the heartbeat", async () => {
      const applicationName = PgTestDatabase.freshApplicationName();
      const store = await PgStore.open({
        url,
        schema: PgTestDatabase.freshSchema(),
        applicationName,
        heartbeatMs: 100,
      });
      try {
        let lost: Error | null = null;
        await store.claimOwnership((reason) => (lost = reason));
        expect(await PgTestDatabase.kill(`${applicationName} owner`)).toBe(1);

        await AsyncChecks.until(async () => (await ownerSessions(applicationName)) === 1);
        await AsyncChecks.until(async () => (await store.measure()).owner === "held");
        expect(lost).toBeNull();
        await store.putSchema(Scope.Default, "posts", { type: "object" });
      } finally {
        await dispose(store);
      }
    });

    test("when another server takes it first, the first is told and refuses every write", async () => {
      const schema = PgTestDatabase.freshSchema();
      const applicationName = PgTestDatabase.freshApplicationName();
      // No automatic beat: the test runs the one that matters, after the rival
      // has the lock, so the race is decided rather than timed.
      const first = await PgStore.open({ url, schema, applicationName, heartbeatMs: 3_600_000 });
      const rival = await PgStore.open({ url, schema, applicationName: `${applicationName}_rival` });
      try {
        let lost: Error | null = null;
        await first.claimOwnership((reason) => (lost = reason));
        await first.putSchema(Scope.Default, "posts", { type: "object" });

        await PgTestDatabase.kill(`${applicationName} owner`);
        await AsyncChecks.until(() => rival.claimOwnership().then(() => true, () => false));

        // White-box, deliberately: one heartbeat, run now.
        await (first as unknown as { owner: { beat(): Promise<void> } }).owner.beat();
        expect(lost).not.toBeNull();
        expect(lost!.message).toMatch(/already owns Postgres schema/);
        expect((await first.measure()).owner).toBe("lost");
        expect(await AsyncChecks.refusal(first.put(entry("late"), { usages: [], search: null }))).toMatch(
          /no longer owns/
        );
        await rival.put(entry("rival"), { usages: [], search: null });
      } finally {
        await dispose(first, rival);
      }
    });

    test("closing gives the lock up only after the pool, so the next owner starts clean", async () => {
      const schema = PgTestDatabase.freshSchema();
      const first = await PgStore.open({ url, schema });
      await first.claimOwnership();
      await first.close();
      const next = await PgStore.open({ url, schema });
      try {
        await next.claimOwnership();
        expect((await next.measure()).owner).toBe("held");
      } finally {
        await dispose(next);
      }
    });
  });

  describe("serve owns its schema", () => {
    test("a second server on one schema is refused, and a one-shot command takes no lock", async () => {
      const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-pg-serve-"));
      const schema = PgTestDatabase.freshSchema();
      const config = ConfigLoader.defaultConfig();
      Object.assign(config.storage, { driver: "postgres", url, schema, path: dataDir });
      config.blob_storage.path = path.join(dataDir, "media");
      config.log.level = "silent";

      const server = await SiloRuntime.open(config, "serve");
      try {
        expect(await AsyncChecks.refusal(SiloRuntime.open(config, "serve"))).toMatch(
          /already owns Postgres schema/
        );
        const oneShot = await SiloRuntime.open(config, "keys");
        await oneShot.close();
      } finally {
        await server.close();
        await PgTestDatabase.drop(schema);
        await fs.rm(dataDir, { recursive: true, force: true });
      }
    });
  });
}

/** Sessions holding a lock for `applicationName`'s owner connection. */
async function ownerSessions(applicationName: string): Promise<number> {
  const rows = await PgTestDatabase.admin((sql) =>
    sql.unsafe(
      `SELECT count(*) AS total FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
       WHERE l.locktype = 'advisory' AND l.granted AND a.application_name = $1`,
      [`${applicationName} owner`]
    )
  );
  return Number(rows[0].total);
}

async function dispose(...stores: PgStore[]): Promise<void> {
  for (const store of stores) await store.close();
  for (const schema of new Set(stores.map((store) => store.schema))) {
    await PgTestDatabase.drop(schema);
  }
}

function entry(id: string): Entry {
  const now = new Date(Date.UTC(2026, 0, 1));
  return {
    id,
    project: Scope.Default.project,
    env: Scope.Default.env,
    collection: "posts",
    rev: 1,
    seq: 0,
    created_at: now,
    updated_at: now,
    data: { title: id },
  };
}
