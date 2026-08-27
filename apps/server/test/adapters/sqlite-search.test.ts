import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { SqliteStore } from "../../src/adapters/storage/sqlite/sqlite-store";
import { SqliteSearcher } from "../../src/adapters/storage/sqlite/sqlite-searcher";
import { SearchIndex } from "../../src/adapters/storage/sqlite/search-index";
import { EntryUtils } from "../../src/core/domain/entry-utils";
import type { Entry } from "../../src/core/domain/entry";
import { Scope } from "../../src/core/domain/scope";
import { SearchText } from "../../src/core/search/search-text";

const Unicode61 = "unicode61 remove_diacritics 2";
const everything = { targets: [{ project: "*", env: "*", collection: "*" }] };

describe("SQLite FTS5 searcher", () => {
  let tempDir: string;
  let dbPath: string;
  let store: SqliteStore;
  let searcher: SqliteSearcher;

  const put = async (
    scope: Scope,
    collection: string,
    data: any,
    schema?: any,
    id?: string
  ): Promise<Entry> => {
    const now = EntryUtils.now();
    const e: Entry = {
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
    await store.put(e, {
      usages: [],
      search: collection.startsWith("_") ? null : SearchText.extract(data, schema),
    });
    return e;
  };

  const titles = async (q: string, access: any = everything, extra: any = {}) => {
    const response = await searcher.search({ q, limit: 50, offset: 0, ...extra }, access);
    return { titles: response.items.map((h) => h.entry.data.title), total: response.total, response };
  };

  const schema = { "x-silo-search": { label: ["$.data.title"] } };

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-fts-test-"));
    dbPath = path.join(tempDir, "silo.db");
    store = await SqliteStore.open(dbPath);
    searcher = store.createSearcher(Unicode61)!;
    expect(searcher).not.toBeNull();
  });

  afterEach(async () => {
    await store.close();
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  test("the shipped build has FTS5, so the native engine is the one in use", () => {
    expect(store.searchIndexed()).toBe(true);
    expect(searcher.capabilities()).toEqual({ engine: "fts5", snippets: true });
  });

  test("matches, and ranks a label hit above a body-only hit", async () => {
    await put(Scope.Default, "posts", { title: "Pricing", body: "nothing" }, schema);
    await put(Scope.Default, "posts", { title: "Other", body: "our pricing page" }, schema);

    const got = await titles("pricing");
    expect(got.total).toBe(2);
    // bm25 with a 10:1 label weight, mirroring the scan engine's scoring.
    expect(got.titles[0]).toBe("Pricing");
  });

  test("every term must match; the last matches as a prefix", async () => {
    await put(Scope.Default, "posts", { title: "Pricing changes", body: "" }, schema);
    await put(Scope.Default, "posts", { title: "Pricing", body: "" }, schema);

    expect((await titles("pricing changes")).total).toBe(1);
    expect((await titles("pricing chan")).total).toBe(1);
    expect((await titles("pricing absent")).total).toBe(0);
  });

  test("FTS5 operator words are searched for, not obeyed", async () => {
    await put(Scope.Default, "posts", { title: "NOT a syntax error", body: "" }, schema);
    // Unquoted, `NOT` is FTS5 query syntax and this would throw.
    expect((await titles("NOT")).total).toBe(1);
  });

  test("an update removes the terms it replaced", async () => {
    // The external-content trap: without the documented 'delete' command in
    // the update trigger, "obsolete" would still match after the rewrite.
    const e = await put(Scope.Default, "posts", { title: "obsolete wording" }, schema);
    expect((await titles("obsolete")).total).toBe(1);

    await store.put(
      { ...e, rev: 2, data: { title: "fresh wording" } },
      { usages: [], search: SearchText.extract({ title: "fresh wording" }, schema) }
    );
    expect((await titles("obsolete")).total).toBe(0);
    expect((await titles("fresh")).total).toBe(1);
  });

  test("a delete removes the document in the same transaction", async () => {
    const e = await put(Scope.Default, "posts", { title: "temporary" }, schema);
    expect((await titles("temporary")).total).toBe(1);
    await store.delete(Scope.Default, "posts", e.id);
    expect((await titles("temporary")).total).toBe(0);
  });

  test("bulk scope deletes take the index with them", async () => {
    const acme = Scope.of("acme", "prod");
    const acmeDev = Scope.of("acme", "dev");
    await put(acme, "posts", { title: "acme prod doc" }, schema);
    await put(acmeDev, "posts", { title: "acme dev doc" }, schema);
    expect((await titles("acme")).total).toBe(2);

    await store.deleteEnvironment("acme", "dev");
    expect((await titles("acme")).total).toBe(1);

    await store.deleteProject("acme");
    expect((await titles("acme")).total).toBe(0);
  });

  test("system data is never indexed, even if a caller passes text", async () => {
    // The caller is supposed to pass `search: null`; the adapter refuses
    // independently, because one forgotten argument must not make a key label
    // findable by text.
    const now = EntryUtils.now();
    await store.put(
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
      await put(Scope.Default, "posts", { title: "shared pricing" }, schema);
      await put(Scope.of("acme", "prod"), "notes", { title: "acme pricing" }, schema);
    });

    test("a narrowed plan narrows total too", async () => {
      const got = await titles("pricing", {
        targets: [{ project: "default", env: "prod", collection: "posts" }],
      });
      expect(got.titles).toEqual(["shared pricing"]);
      expect(got.total).toBe(1);
    });

    test("an empty plan denies everything", async () => {
      const got = await titles("pricing", { targets: [] });
      expect(got.total).toBe(0);
    });

    test("the request reach narrows on top of the plan", async () => {
      const got = await titles("pricing", everything, { project: "acme", env: "prod" });
      expect(got.titles).toEqual(["acme pricing"]);
      expect(got.total).toBe(1);
    });
  });

  test("filters and explicit sort compose with the text query", async () => {
    await put(Scope.Default, "posts", { title: "pricing a", views: 1 }, schema);
    await put(Scope.Default, "posts", { title: "pricing b", views: 9 }, schema);

    const filtered = await titles("pricing", everything, {
      filter: { op: "gt", path: "$.data.views", value: 5 },
    });
    expect(filtered.titles).toEqual(["pricing b"]);

    const sorted = await titles("pricing", everything, {
      sort: [{ path: "$.data.views", desc: false }],
    });
    expect(sorted.titles).toEqual(["pricing a", "pricing b"]);
  });

  test("snippets name the field, exactly as the portable engine does", async () => {
    await put(Scope.Default, "posts", { title: "x", body: "We met in Café Central." }, schema);
    const { response } = await titles("cafe");
    const snippet = response.items[0].snippets.find((s) => s.path === "$.data.body");
    expect(snippet?.match).toBe("Café");
  });

  test("paging is stable across pages", async () => {
    for (let i = 0; i < 5; i++) await put(Scope.Default, "posts", { title: `pricing ${i}` }, schema);
    const p1 = await searcher.search({ q: "pricing", limit: 2, offset: 0 }, everything);
    const p2 = await searcher.search({ q: "pricing", limit: 2, offset: 2 }, everything);
    expect(p1.total).toBe(5);
    expect(new Set([...p1.items, ...p2.items].map((h) => h.entry.id)).size).toBe(4);
  });

  describe("rebuild and integrity", () => {
    test("reindex fills an index that was emptied underneath it", async () => {
      await put(Scope.Default, "posts", { title: "rebuildable" }, schema);
      await store.putSchema(Scope.Default, "posts", schema);
      expect((await titles("rebuildable")).total).toBe(1);

      // Simulate a dropped index without touching entries.
      (store as any).database.exec(`DELETE FROM ${SearchIndex.Documents}`);
      expect((await titles("rebuildable")).total).toBe(0);

      const report = await searcher.reindex();
      expect(report.entries).toBe(1);
      expect((await titles("rebuildable")).total).toBe(1);
    });

    test("both integrity checks pass on a healthy index", async () => {
      await put(Scope.Default, "posts", { title: "healthy" }, schema);
      expect(searcher.check()).toEqual({
        index: "ok",
        orphanDocuments: 0,
        missingDocuments: 0,
      });
    });

    test("the second check sees drift the built-in one cannot", async () => {
      await put(Scope.Default, "posts", { title: "drifting" }, schema);
      // Delete the entry behind the index's back. FTS5's own integrity-check
      // compares the index to the document table and is blind to this.
      (store as any).database.exec(`DELETE FROM entries`);
      const report = searcher.check();
      expect(report.index).toBe("ok");
      expect(report.orphanDocuments).toBe(1);
    });

    test("a fresh database with content is reported as needing a rebuild", async () => {
      await put(Scope.Default, "posts", { title: "existing" }, schema);
      await store.close();

      // Reopen with a different tokenizer: the tokenizer is fixed into the
      // virtual table at creation, so this is a rebuild, not an update.
      store = await SqliteStore.open(dbPath, { enabled: true, tokenizer: "trigram" });
      expect(store.needsSearchRebuild()).toBe(true);

      searcher = store.createSearcher("trigram")!;
      expect((await titles("existing")).total).toBe(0);
      await searcher.reindex();
      expect((await titles("existing")).total).toBe(1);
    });

    test("reopening with the same tokenizer needs no rebuild", async () => {
      await put(Scope.Default, "posts", { title: "stable" }, schema);
      await store.close();
      store = await SqliteStore.open(dbPath);
      expect(store.needsSearchRebuild()).toBe(false);
      searcher = store.createSearcher(Unicode61)!;
      expect((await titles("stable")).total).toBe(1);
    });
  });

  test("search switched off keeps no index and offers no native engine", async () => {
    await store.close();
    store = await SqliteStore.open(dbPath, { enabled: false, tokenizer: Unicode61 });
    expect(store.searchIndexed()).toBe(false);
    expect(store.createSearcher(Unicode61)).toBeNull();
  });

  test("a disabled open does not destroy an index, but does force a rebuild", async () => {
    // Every CLI subcommand opens the store. One `silo keys list` from a build
    // without FTS5 must not delete the index a running server maintains on the
    // same data dir — so the stamp is cleared and the tables are left alone.
    await put(Scope.Default, "posts", { title: "survivor" }, schema);
    await store.putSchema(Scope.Default, "posts", schema);
    await store.close();

    const disabled = await SqliteStore.open(dbPath, { enabled: false, tokenizer: Unicode61 });
    const rows = (disabled as any).database
      .prepare(`SELECT COUNT(*) AS n FROM ${SearchIndex.Documents}`)
      .get();
    expect(rows.n).toBe(1);
    await disabled.close();

    // Re-enabling cannot trust rows nothing was maintaining, so it rebuilds.
    store = await SqliteStore.open(dbPath);
    expect(store.needsSearchRebuild()).toBe(true);
    searcher = store.createSearcher(Unicode61)!;
    await searcher.reindex();
    expect((await titles("survivor")).total).toBe(1);
  });
});

describe("trigram tokenizer", () => {
  let tempDir: string;
  let store: SqliteStore;
  let searcher: SqliteSearcher;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-fts-tri-"));
    store = await SqliteStore.open(path.join(tempDir, "silo.db"), {
      enabled: true,
      tokenizer: "trigram",
    });
    searcher = store.createSearcher("trigram")!;
  });

  afterEach(async () => {
    await store.close();
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  test("substring matching, which unicode61 cannot do", async () => {
    const now = EntryUtils.now();
    const data = { title: "internationalisation" };
    await store.put(
      {
        id: EntryUtils.newID(),
        project: Scope.Default.project,
        env: Scope.Default.env,
        collection: "posts",
        rev: 1,
        seq: 0,
        created_at: now,
        updated_at: now,
        data,
      },
      { usages: [], search: SearchText.extract(data) }
    );

    const hit = await searcher.search({ q: "national", limit: 10, offset: 0 }, everything);
    expect(hit.total).toBe(1);
  });

  test("a term shorter than a trigram falls back rather than failing", async () => {
    const now = EntryUtils.now();
    const data = { title: "go lang" };
    await store.put(
      {
        id: EntryUtils.newID(),
        project: Scope.Default.project,
        env: Scope.Default.env,
        collection: "posts",
        rev: 1,
        seq: 0,
        created_at: now,
        updated_at: now,
        data,
      },
      { usages: [], search: SearchText.extract(data) }
    );

    // "go" has no trigram, so it is matched by substring against the stored
    // document instead — unindexed, but correct.
    const hit = await searcher.search({ q: "go", limit: 10, offset: 0 }, everything);
    expect(hit.total).toBe(1);
  });
});
