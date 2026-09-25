import { afterAll, beforeEach, afterEach, describe, expect, test } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { PgSearchIndex } from "../../src/adapters/storage/postgres/pg-search-index";
import type { PgSearcher } from "../../src/adapters/storage/postgres/pg-searcher";
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
