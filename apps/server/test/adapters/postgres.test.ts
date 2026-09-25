import { describe, expect, test } from "bun:test";
import { runStorageTestSuite } from "../conformance/storage-conformance";
import { PgStore } from "../../src/adapters/storage/postgres/pg-store";
import type { Entry } from "../../src/core/domain/entry";
import { EntryUtils } from "../../src/core/domain/entry-utils";
import { Scope } from "../../src/core/domain/scope";
import { SystemCollections } from "../../src/core/domain/system-collections";
import { FormatVersion } from "../../src/core/transfer/format-version";
import { AsyncChecks } from "./support/async-checks";
import { PgTestDatabase } from "./support/pg-test-database";

const url = PgTestDatabase.url();

/** A store on a schema of its own, dropped by `dispose`. */
async function openFresh(options: { schema?: string; applicationName?: string } = {}) {
  return PgStore.open({
    ...options,
    url: url!,
    schema: options.schema ?? PgTestDatabase.freshSchema(),
  });
}

async function dispose(...stores: PgStore[]): Promise<void> {
  for (const store of stores) await store.close();
  for (const schema of new Set(stores.map((store) => store.schema))) {
    await PgTestDatabase.drop(schema);
  }
}

if (!url) {
  describe.skip(`Postgres adapter (set ${PgTestDatabase.Variable} to run)`, () => {
    test("conformance, format guard, first start, owner lock, close", () => {});
  });
} else {
  runStorageTestSuite(
    "Postgres Store",
    async () => openFresh(),
    async (store) => dispose(store as PgStore)
  );

  describe("PgStore format guard", () => {
    test("stamps a fresh schema with the current format_version", async () => {
      const store = await openFresh();
      try {
        const rows = await PgTestDatabase.admin((sql) =>
          sql.unsafe(`SELECT value FROM "${store.schema}".meta WHERE key = 'format_version'`)
        );
        expect(rows[0].value).toBe(FormatVersion);
        expect((await store.meta()).instance_id).not.toBe("");
      } finally {
        await dispose(store);
      }
    });

    test("refuses a schema stamped with another format_version", async () => {
      const store = await openFresh();
      await store.close();
      await PgTestDatabase.admin((sql) =>
        sql.unsafe(`UPDATE "${store.schema}".meta SET value = '0' WHERE key = 'format_version'`)
      );
      try {
        expect(await AsyncChecks.refusal(openFresh({ schema: store.schema }))).toMatch(/format_version "0"/);
      } finally {
        await PgTestDatabase.drop(store.schema);
      }
    });

    test("refuses a schema holding a table silo did not create", async () => {
      // A schema shared with another application must not have its tables
      // adopted by CREATE TABLE IF NOT EXISTS.
      const schema = PgTestDatabase.freshSchema();
      await PgTestDatabase.admin(async (sql) => {
        await sql.unsafe(`CREATE SCHEMA "${schema}"`);
        await sql.unsafe(`CREATE TABLE "${schema}".entries (id integer)`);
      });
      try {
        expect(await AsyncChecks.refusal(openFresh({ schema }))).toMatch(/"entries" that silo did not create/);
      } finally {
        await PgTestDatabase.drop(schema);
      }
    });

    test("refuses a schema name that would need quoting", async () => {
      expect(await AsyncChecks.refusal(openFresh({ schema: "Silo-Data" }))).toMatch(
        /invalid Postgres schema name/
      );
    });
  });

  describe("PgStore first start", () => {
    test("two stores opening one empty schema at once agree on everything", async () => {
      const schema = PgTestDatabase.freshSchema();
      const [first, second] = await Promise.all([openFresh({ schema }), openFresh({ schema })]);
      try {
        expect((await first.meta()).instance_id).toBe((await second.meta()).instance_id);
        const rows = await PgTestDatabase.admin((sql) =>
          sql.unsafe(`SELECT count(*) AS total FROM "${schema}".collections`)
        );
        expect(Number(rows[0].total)).toBe(SystemCollections.All.length);
      } finally {
        await dispose(first, second);
      }
    });

    test("reopening keeps the instance id and the sequence", async () => {
      const store = await openFresh();
      await store.putSchema(Scope.Default, "posts", { type: "object" });
      await store.put(entry("a"), { usages: [], search: null });
      const before = await store.meta();
      await store.close();

      const reopened = await openFresh({ schema: store.schema });
      try {
        expect(await reopened.meta()).toEqual(before);
        expect(before.last_seq).toBe(1);
      } finally {
        await dispose(reopened);
      }
    });
  });

  describe("PgStore writes", () => {
    test("concurrent writes take distinct seq numbers with no gaps", async () => {
      const store = await openFresh();
      try {
        await store.putSchema(Scope.Default, "posts", { type: "object" });
        const entries = Array.from({ length: 20 }, (_, index) => entry(`e${index}`));
        await Promise.all(entries.map((item) => store.put(item, { usages: [], search: null })));

        const seqs = entries.map((item) => item.seq).sort((a, b) => a - b);
        expect(seqs).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
        expect((await store.meta()).last_seq).toBe(20);
      } finally {
        await dispose(store);
      }
    });

    test("a write into a collection deleted since its lookup is not found, not a 500", async () => {
      const store = await openFresh();
      try {
        await store.putSchema(Scope.Default, "posts", { type: "object" });
        await store.put(entry("a"), { usages: [], search: null });
        await store.delete(Scope.Default, "posts", "a");
        await store.deleteSchema(Scope.Default, "posts");
        expect(await AsyncChecks.refusal(store.put(entry("b"), { usages: [], search: null }))).toMatch(
          /not found/
        );
      } finally {
        await dispose(store);
      }
    });
  });

  describe("PgStore owner lock", () => {
    test("a second owner of the same schema is refused at once", async () => {
      const owner = await openFresh();
      const rival = await openFresh({ schema: owner.schema });
      try {
        await owner.claimOwnership();
        expect(await AsyncChecks.refusal(rival.claimOwnership())).toMatch(/already owns Postgres schema/);
      } finally {
        await dispose(owner, rival);
      }
    });

    test("another schema in the same database has an owner of its own", async () => {
      const one = await openFresh();
      const other = await openFresh();
      try {
        await one.claimOwnership();
        await other.claimOwnership();
      } finally {
        await dispose(one, other);
      }
    });

    test("closing the owner lets the next server in, and claiming twice is harmless", async () => {
      const owner = await openFresh();
      await owner.claimOwnership();
      await owner.claimOwnership();
      await owner.close();

      const next = await openFresh({ schema: owner.schema });
      try {
        await next.claimOwnership();
      } finally {
        await dispose(next);
      }
    });
  });

  describe("PgStore close", () => {
    test("leaves no session behind", async () => {
      const applicationName = `silo_test_${EntryUtils.newID().toLowerCase()}`;
      const store = await openFresh({ applicationName });
      await store.claimOwnership();
      await store.putSchema(Scope.Default, "posts", { type: "object" });
      await Promise.all(
        Array.from({ length: 5 }, () => store.list(Scope.Default, "posts", { limit: 10, offset: 0 }))
      );
      expect(await PgTestDatabase.sessions(applicationName)).toBeGreaterThan(0);

      await store.close();
      await store.close();
      // A backend exits a moment after its socket closes, so poll briefly.
      let remaining = await PgTestDatabase.sessions(applicationName);
      for (let attempt = 0; remaining > 0 && attempt < 20; attempt += 1) {
        await Bun.sleep(100);
        remaining = await PgTestDatabase.sessions(applicationName);
      }
      expect(remaining).toBe(0);
      await PgTestDatabase.drop(store.schema);
    });
  });
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
