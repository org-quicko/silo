import { afterAll, beforeEach, afterEach, describe, expect, test } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { PgSearchIndex } from "../../src/adapters/storage/postgres/pg-search-index";
import { PgSearcher } from "../../src/adapters/storage/postgres/pg-searcher";
import { PgStore, type PgStoreOptions } from "../../src/adapters/storage/postgres/pg-store";
import { SiloRuntime } from "../../src/cli/runtime/silo-runtime";
import { ConfigLoader } from "../../src/config/config-loader";
import type { Entry } from "../../src/core/domain/entry";
import { EntryUtils } from "../../src/core/domain/entry-utils";
import { Scope } from "../../src/core/domain/scope";
import type { SearchAccess } from "../../src/core/search/search-access";
import { SearchText } from "../../src/core/search/search-text";
import { PgTestDatabase } from "./support/pg-test-database";

/**
 * The Postgres engine (P4), held to what `sqlite-search.test.ts` holds FTS5
 * to: which entries come back, that a label match ranks above a body match,
 * access in SQL, the index kept inside the entry's own writes, and the stamp
 * that forces a rebuild. Scores are the engine's own and are not compared.
 */
const url = PgTestDatabase.url();
const everything: SearchAccess = { targets: [{ project: "*", env: "*", collection: "*" }] };
const schema = { "x-silo-search": { label: ["$.data.title"] } };

/** A store on a fresh schema, with an entry writer and a title-level search. */
function harness(options: Partial<PgStoreOptions> = {}) {
  const state = { store: null as unknown as PgStore, searcher: null as unknown as PgSearcher };

  const open = async (overrides: Partial<PgStoreOptions> = {}) => {
    state.store = await PgStore.open({ url: url!, ...options, ...overrides });
    state.searcher = state.store.createSearcher()!;
    return state.store;
  };

  const put = async (scope: Scope, collection: string, data: any, id?: string): Promise<Entry> => {
    const now = EntryUtils.now();
    const entry: Entry = {
      id: id ?? EntryUtils.newID(),
      project: scope.project,
      env: scope.env,
      collection,
      rev: 1,
      seq: 0,
      created_at: now,
      updated_at: now,
      data,
    };
    if (!(await state.store.findCollection(scope, collection))) {
      await state.store.putSchema(scope, collection, collection.startsWith("_") ? { type: "object" } : schema);
    }
    await state.store.put(entry, {
      usages: [],
      search: collection.startsWith("_") ? null : SearchText.extract(data, schema),
    });
    return entry;
  };

  const titles = async (q: string, access: SearchAccess = everything, extra: object = {}) => {
    const response = await state.searcher.search({ q, limit: 50, offset: 0, ...extra }, access);
    return { titles: response.items.map((hit) => hit.entry.data.title), total: response.total, response };
  };

  return { state, open, put, titles };
}

if (!url) {
  PgTestDatabase.skipping(`${PgTestDatabase.Variable} is not set`);
  describe.skip(`Postgres search (set ${PgTestDatabase.Variable} to run)`, () => {
    test("matching, ranking, access, index maintenance, rebuild", () => {});
  });
} else {
  describe("Postgres searcher (unicode61)", () => {
    const { state, open, put, titles } = harness();
    let schemaName: string;

    beforeEach(async () => {
      schemaName = PgTestDatabase.freshSchema();
      await open({ schema: schemaName });
    });

    afterEach(async () => {
      await state.store.close();
      await PgTestDatabase.drop(schemaName);
    });

    test("the native engine is the one offered, and a fresh schema needs no rebuild", () => {
      expect(state.searcher.capabilities()).toEqual({ engine: "postgres", snippets: true });
      expect(state.store.needsSearchRebuild()).toBe(false);
    });

    test("matches, and ranks a label hit above a body-only hit", async () => {
      await put(Scope.Default, "posts", { title: "Other", body: "our pricing page" });
      await put(Scope.Default, "posts", { title: "Pricing", body: "nothing" });
      const got = await titles("pricing");
      expect(got.total).toBe(2);
      expect(got.titles[0]).toBe("Pricing");
      expect(got.response.engine).toBe("postgres");
    });

    test("every term must match; the last matches as a prefix", async () => {
      await put(Scope.Default, "posts", { title: "Pricing changes" });
      await put(Scope.Default, "posts", { title: "Pricing" });
      expect((await titles("pricing changes")).total).toBe(1);
      expect((await titles("pricing chan")).total).toBe(1);
      expect((await titles("pricing chan ")).total).toBe(0);
      expect((await titles("pricing absent")).total).toBe(0);
    });

    test("query operator words are searched for, not obeyed", async () => {
      await put(Scope.Default, "posts", { title: "NOT a syntax error" });
      expect((await titles("NOT")).total).toBe(1);
      // tsquery's operators are separators to the tokenizer, so they reach SQL as nothing.
      expect((await titles("not & ! <->")).total).toBe(1);
    });

    test("accents fold on both sides, as the scan folds them", async () => {
      await put(Scope.Default, "posts", { title: "Crème brûlée" });
      expect((await titles("creme")).total).toBe(1);
      expect((await titles("BRÛLÉE")).total).toBe(1);
    });

    test("an update removes the terms it replaced, and a delete the row", async () => {
      const entry = await put(Scope.Default, "posts", { title: "obsolete wording" });
      await state.store.put(
        { ...entry, rev: 2, data: { title: "fresh wording" } },
        { usages: [], search: SearchText.extract({ title: "fresh wording" }, schema) }
      );
      expect((await titles("obsolete")).total).toBe(0);
      expect((await titles("fresh")).total).toBe(1);

      await state.store.delete(Scope.Default, "posts", entry.id);
      expect((await titles("fresh")).total).toBe(0);
    });

    test("bulk scope deletes take the index with them", async () => {
      await put(Scope.of("acme", "prod"), "posts", { title: "acme prod doc" });
      await put(Scope.of("acme", "dev"), "posts", { title: "acme dev doc" });
      expect((await titles("acme")).total).toBe(2);
      await state.store.deleteEnvironment("acme", "dev");
      expect((await titles("acme")).total).toBe(1);
      await state.store.deleteProject("acme");
      expect((await titles("acme")).total).toBe(0);
    });

    test("system data is never indexed, even if a caller passes text", async () => {
      const now = EntryUtils.now();
      await state.store.put(
        {
          id: EntryUtils.newID(),
          project: Scope.System.project,
          env: Scope.System.env,
          collection: "_keys",
          rev: 1,
          seq: 0,
          created_at: now,
          updated_at: now,
          data: { label: "supersecret deploy key" },
        },
        { usages: [], search: SearchText.extract({ label: "supersecret deploy key" }) }
      );
      expect((await titles("supersecret")).total).toBe(0);
    });

    describe("access is applied in SQL, not after", () => {
      beforeEach(async () => {
        await put(Scope.Default, "posts", { title: "shared pricing" });
        await put(Scope.of("acme", "prod"), "notes", { title: "acme pricing" });
        await put(Scope.of("acme_labs", "prod"), "notes", { title: "labs pricing" });
      });

      test("a narrowed plan narrows total too", async () => {
        const got = await titles("pricing", {
          targets: [{ project: "default", env: "prod", collection: "posts" }],
        });
        expect(got.titles).toEqual(["shared pricing"]);
        expect(got.total).toBe(1);
      });

      test("a prefix claim reads the names under it, and an id's _ is a character, not a wildcard", async () => {
        const got = await titles("pricing", {
          targets: [{ project: "acme_*", env: "*", collection: "*" }],
        });
        expect(got.titles).toEqual(["labs pricing"]);
      });

      test("an empty plan denies everything", async () => {
        expect((await titles("pricing", { targets: [] })).total).toBe(0);
      });

      test("the request reach narrows on top of the plan", async () => {
        const got = await titles("pricing", everything, { project: "acme", env: "prod" });
        expect(got.titles).toEqual(["acme pricing"]);
      });
    });

    test("filters and explicit sort compose with the text query", async () => {
      await put(Scope.Default, "posts", { title: "pricing a", views: 1 });
      await put(Scope.Default, "posts", { title: "pricing b", views: 9 });
      const filtered = await titles("pricing", everything, {
        filter: { op: "gt", path: "$.data.views", value: 5 },
      });
      expect(filtered.titles).toEqual(["pricing b"]);
      const sorted = await titles("pricing", everything, { sort: [{ path: "$.data.views", desc: true }] });
      expect(sorted.titles).toEqual(["pricing b", "pricing a"]);
    });

    test("with no text it is a filter over what is indexed, newest first", async () => {
      await put(Scope.Default, "posts", { title: "older", views: 3 });
      await Bun.sleep(5);
      await put(Scope.Default, "posts", { title: "newer", views: 3 });
      const got = await titles("", everything, { filter: { op: "eq", path: "$.data.views", value: 3 } });
      expect(got.titles).toEqual(["newer", "older"]);
    });

    test("snippets name the field, exactly as the portable engine does", async () => {
      await put(Scope.Default, "posts", { title: "x", body: "We met in Café Central." });
      const { response } = await titles("cafe");
      const snippet = response.items[0].snippets.find((each) => each.path === "$.data.body");
      expect(snippet?.match).toBe("Café");
    });

    test("paging is stable, and the total survives a page past the end", async () => {
      for (let i = 0; i < 5; i++) await put(Scope.Default, "posts", { title: `pricing ${i}` });
      const first = await state.searcher.search({ q: "pricing", limit: 2, offset: 0 }, everything);
      const second = await state.searcher.search({ q: "pricing", limit: 2, offset: 2 }, everything);
      const beyond = await state.searcher.search({ q: "pricing", limit: 2, offset: 10 }, everything);
      expect(first.total).toBe(5);
      expect(new Set([...first.items, ...second.items].map((hit) => hit.entry.id)).size).toBe(4);
      expect(beyond.items).toEqual([]);
      expect(beyond.total).toBe(5);
      // Sorted by a field of the data, the recount must not carry the sort's parameters.
      const sortedBeyond = await state.searcher.search(
        { q: "pricing", limit: 2, offset: 10, sort: [{ path: "$.data.title", desc: false }] },
        everything
      );
      expect(sortedBeyond).toMatchObject({ items: [], total: 5 });
    });

    test("a term up to the lexeme limit is indexed, and a longer one is left out rather than refused", async () => {
      // Postgres holds a lexeme of at most 2046 bytes and refuses 2047 with 54000.
      const longest = "a".repeat(2046);
      const tooLong = "b".repeat(2047);
      await put(Scope.Default, "posts", { title: `fits ${longest}` });
      await put(Scope.Default, "posts", { title: `spills ${tooLong}` });
      expect((await titles(longest)).total).toBe(1);
      expect((await titles("spills")).total).toBe(1);
      expect((await titles(tooLong)).total).toBe(0);
    });

    describe("rebuild and integrity", () => {
      test("reindex fills an index that was emptied underneath it", async () => {
        await put(Scope.Default, "posts", { title: "rebuildable" });
        await sql(`DELETE FROM "${schemaName}".entry_search`);
        expect((await titles("rebuildable")).total).toBe(0);
        expect(await state.searcher.reindex()).toEqual({ collections: 1, entries: 1 });
        expect((await titles("rebuildable")).total).toBe(1);
      });

      test("the checks pass on a healthy index, and see a missing and an orphaned row", async () => {
        const kept = await put(Scope.Default, "posts", { title: "healthy" });
        await put(Scope.Default, "posts", { title: "orphaned" });
        expect(await state.searcher.check()).toEqual({ index: "ok", orphanDocuments: 0, missingDocuments: 0 });

        await sql(`DELETE FROM "${schemaName}".entry_search WHERE entry_id = '${kept.id}'`);
        // The cascade makes an orphan unreachable through the port; lifting it
        // is the only way to build one, and the anti-join is what would notice.
        await sql(
          `ALTER TABLE "${schemaName}".entry_search DROP CONSTRAINT entry_search_collection_id_entry_id_fkey`
        );
        await sql(`DELETE FROM "${schemaName}".entries WHERE data->>'title' = 'orphaned'`);
        expect(await state.searcher.check()).toEqual({ index: "ok", orphanDocuments: 1, missingDocuments: 1 });
      });

      test("a moved stamp forces a rebuild, and the same stamp does not", async () => {
        await put(Scope.Default, "posts", { title: "existing" });
        await state.store.close();

        state.store = await PgStore.open({ url, schema: schemaName });
        expect(state.store.needsSearchRebuild()).toBe(false);
        await state.store.close();

        await sql(`UPDATE "${schemaName}".meta SET value = 'older' WHERE key = '${PgSearchIndex.StampKey}'`);
        await open({ schema: schemaName });
        expect(state.store.needsSearchRebuild()).toBe(true);
        expect((await titles("existing")).total).toBe(0);
        await state.searcher.reindex();
        expect((await titles("existing")).total).toBe(1);
      });

      test("a disabled open keeps the rows but forces a rebuild when search comes back", async () => {
        await put(Scope.Default, "posts", { title: "survivor" });
        await state.store.close();

        const disabled = await PgStore.open({ url, schema: schemaName, search: { enabled: false, tokenizer: "unicode61" } });
        expect(disabled.createSearcher()).toBeNull();
        const rows = await sql(`SELECT count(*) AS n FROM "${schemaName}".entry_search`);
        expect(Number(rows[0].n)).toBe(1);
        await disabled.close();

        await open({ schema: schemaName });
        expect(state.store.needsSearchRebuild()).toBe(true);
      });

      test("reindex never writes text read before a save over the row that save wrote", async () => {
        const entry = await put(Scope.Default, "posts", { title: "oldword" }, "E1");
        // White-box, deliberately: the save lands between the page read and
        // the upsert, which no timing can arrange on demand.
        const connection = (state.store as unknown as { connection: { query: (...args: any[]) => Promise<any[]> } }).connection;
        const query = connection.query.bind(connection);
        let saved = false;
        connection.query = async (text: string, params?: unknown[]) => {
          const rows = await query(text, params);
          if (!saved && /id > \$2/.test(text)) {
            saved = true;
            await put(Scope.Default, "posts", { title: "newword" }, entry.id);
          }
          return rows;
        };
        try {
          await state.searcher.reindex();
        } finally {
          connection.query = query;
        }
        expect(saved).toBe(true);
        expect((await titles("newword")).total).toBe(1);
        expect((await titles("oldword")).total).toBe(0);
      });

      test("reindex pages by id, so a delete behind a page does not skip an entry", async () => {
        const ids = ["E1", "E2", "E3", "E4", "E5"];
        for (const id of ids) await put(Scope.Default, "posts", { title: `paged ${id}` }, id);
        await sql(`DELETE FROM "${schemaName}".entry_search`);
        const searcher = PgSearcher as unknown as { ReindexPage: number };
        const pageSize = searcher.ReindexPage;
        searcher.ReindexPage = 2;
        const connection = (state.store as unknown as { connection: { query: (...args: any[]) => Promise<any[]> } }).connection;
        const query = connection.query.bind(connection);
        let pages = 0;
        connection.query = async (text: string, params?: unknown[]) => {
          const rows = await query(text, params);
          if (/id > \$2/.test(text) && ++pages === 1) await state.store.delete(Scope.Default, "posts", "E1");
          return rows;
        };
        try {
          await state.searcher.reindex();
        } finally {
          connection.query = query;
          searcher.ReindexPage = pageSize;
        }
        expect((await titles("paged")).titles.sort()).toEqual(["paged E2", "paged E3", "paged E4", "paged E5"]);
        expect(await state.searcher.check()).toEqual({ index: "ok", orphanDocuments: 0, missingDocuments: 0 });
      });
    });

    describe("the index belongs to the schema's owner", () => {
      const stamp = async () =>
        (await sql(`SELECT value FROM "${schemaName}".meta WHERE key = '${PgSearchIndex.StampKey}'`))[0]?.value ?? null;
      const write = (store: PgStore, id: string, title: string) => {
        const now = EntryUtils.now();
        const data = { title };
        return store.put(
          { id, project: Scope.Default.project, env: Scope.Default.env, collection: "posts", rev: 1, seq: 0, created_at: now, updated_at: now, data },
          { usages: [], search: SearchText.extract(data, schema) }
        );
      };

      test("a store opened beside a running server follows its index, whatever its own [search] says", async () => {
        await state.store.claimOwnership();
        await put(Scope.Default, "posts", { title: "owned" });
        const before = await stamp();

        // Trigram would need a new table in another form; search off would clear the stamp.
        const trigram = await PgStore.open({ url, schema: schemaName, search: { enabled: true, tokenizer: "trigram" } });
        const off = await PgStore.open({ url, schema: schemaName, search: { enabled: false, tokenizer: "unicode61" } });
        try {
          expect(await stamp()).toBe(before);
          expect(trigram.createSearcher()?.capabilities().engine).toBe("postgres");
          expect(off.createSearcher()).not.toBeNull();
          // Rows written beside the server are in the server's form, so it finds them.
          await write(trigram, "BESIDE", "beside");
          expect((await titles("beside")).total).toBe(1);
          expect((await titles("owned")).total).toBe(1);
        } finally {
          await trigram.close();
          await off.close();
        }
      });

      test("a server applies its own [search] once it holds the lock", async () => {
        await state.store.claimOwnership();
        await put(Scope.Default, "posts", { title: "handover" });
        const next = await PgStore.open({ url, schema: schemaName, search: { enabled: false, tokenizer: "unicode61" } });
        try {
          // While the first server runs, the second follows it.
          expect(next.createSearcher()).not.toBeNull();
          await state.store.close();
          await next.claimOwnership();
          expect(await stamp()).toBeNull();
          expect(next.createSearcher()).toBeNull();
        } finally {
          await next.close();
          state.store = await PgStore.open({ url, schema: schemaName });
        }
      });
    });

    test("the runtime answers search with this engine, and fills an empty index at the start", async () => {
      await put(Scope.Default, "posts", { title: "startup" });
      await state.store.close();
      await sql(`DELETE FROM "${schemaName}".entry_search`);

      const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-pg-search-"));
      const config = ConfigLoader.defaultConfig();
      Object.assign(config.storage, { driver: "postgres", url, schema: schemaName, path: dataDir });
      config.blob_storage.path = path.join(dataDir, "media");
      const runtime = await SiloRuntime.open(config, "search");
      try {
        expect(runtime.service.search.capabilities().engine).toBe("postgres");
        const [row] = await sql(`SELECT count(*) AS n FROM "${schemaName}".entry_search`);
        expect(Number(row.n)).toBe(1);
      } finally {
        await runtime.close();
        await fs.rm(dataDir, { recursive: true, force: true });
      }
      state.store = await PgStore.open({ url, schema: schemaName });
    });

    function sql(text: string) {
      return PgTestDatabase.admin((admin) => admin.unsafe(text));
    }
  });

  const trigram = await PgTestDatabase.ensureTrigram();
  afterAll(() => trigram.cleanup());
  if (!trigram.ready) PgTestDatabase.skipping("pg_trgm is missing and this role may not install it");

  describe.skipIf(!trigram.ready)("Postgres searcher (trigram)", () => {
    const { state, open, put, titles } = harness({ search: { enabled: true, tokenizer: "trigram" } });
    let schemaName: string;

    beforeEach(async () => {
      schemaName = PgTestDatabase.freshSchema();
      await open({ schema: schemaName });
    });

    afterEach(async () => {
      await state.store.close();
      await PgTestDatabase.drop(schemaName);
    });

    test("substring matching, which unicode61 cannot do", async () => {
      await put(Scope.Default, "posts", { title: "internationalisation" });
      expect((await titles("national")).total).toBe(1);
    });

    test("a term shorter than a trigram is still matched, by scanning", async () => {
      await put(Scope.Default, "posts", { title: "go lang" });
      expect((await titles("go")).total).toBe(1);
    });

    test("text with no spaces between words is found by any part of it", async () => {
      await put(Scope.Default, "posts", { title: "日本語のテキスト" });
      expect((await titles("テキスト")).total).toBe(1);
    });

    test("a label hit ranks above a body-only hit here too", async () => {
      await put(Scope.Default, "posts", { title: "Other", body: "national news" });
      await put(Scope.Default, "posts", { title: "National", body: "nothing" });
      expect((await titles("national")).titles[0]).toBe("National");
    });

    test("switching tokenizer rebuilds rather than trusting rows written by the other one", async () => {
      await put(Scope.Default, "posts", { title: "switching" });
      await state.store.close();
      await open({ schema: schemaName, search: { enabled: true, tokenizer: "unicode61" } });
      expect(state.store.needsSearchRebuild()).toBe(true);
      await state.searcher.reindex();
      expect((await titles("switching")).total).toBe(1);
    });
  });
}
