import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { Hono } from "hono";
import { SqliteStore } from "../../src/adapters/storage/sqlite/sqlite-store";
import { SiloService } from "../../src/core/services/silo-service";
import { EntryUtils } from "../../src/core/domain/entry-utils";
import type { Entry } from "../../src/core/domain/entry";
import { Scope } from "../../src/core/domain/scope";
import { SiloServer } from "../../src/http/server";
import { Logger } from "../../src/logging/logger";

describe("Entries API Response Format", () => {
  let tempDir: string;
  let store: SqliteStore;
  let service: SiloService;
  let app: Hono;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-entries-api-test-"));
    store = await SqliteStore.open(path.join(tempDir, "test.db"));
    service = new SiloService(store);
    // Built through SiloServer, not a bare Hono: the error handler that maps
    // ValidationError to a 400 lives there, so a bare app reports every
    // rejected query as a 500 and no test can tell the two apart.
    app = new SiloServer(service, { version: "test", authDisabled: true, logger: Logger.silent() }).build();
  });

  afterEach(async () => {
    await store.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test("EntryUtils.toApiResponse flattens entry correctly", () => {
    const now = new Date("2026-07-09T13:01:42.112Z");
    const e: Entry = {
      id: "01KX3FGFV01GWEBZEHDNZ38239",
      project: Scope.Default.project,
      env: Scope.Default.env,
      collection: "in-co-sandbox-it-2026-deductions",
      rev: 2,
      seq: 10,
      created_at: now,
      updated_at: now,
      data: {
        section: "80G",
        regime: "old",
        assesse: "individual",
        allowable_percentage: 100,
        faqs: {
          question: "test",
          answer: "test",
        },
      },
    };

    const formatted = EntryUtils.toApiResponse(e);
    expect(formatted).toEqual({
      id: "01KX3FGFV01GWEBZEHDNZ38239",
      rev: 2,
      section: "80G",
      regime: "old",
      assesse: "individual",
      allowable_percentage: 100,
      faqs: {
        question: "test",
        answer: "test",
      },
      created_at: "2026-07-09T13:01:42.112Z",
      updated_at: "2026-07-09T13:01:42.112Z",
    });
  });

  // D29 over the wire: the query string is where a client meets the path
  // grammar, so the rejections matter as much as the matches.
  describe("list query paths (D29)", () => {
    const seed = async () => {
      await service.collections.putSchema(Scope.Default, "posts", { type: "object" });
      await service.entries.create(Scope.Default, "posts", {
        title: "alpha",
        views: 10,
        tags: ["go", "cms"],
      });
      await service.entries.create(Scope.Default, "posts", { title: "beta", views: 3 });
    };
    const list = (qs: string) =>
      app.request(`/api/projects/default/environments/prod/collections/posts?${qs}`);
    const titles = async (res: Response) =>
      ((await res.json()) as { data: any[] }).data.map((e) => e.title);

    test("filters and sorts on paths", async () => {
      await seed();
      const filter = encodeURIComponent(
        JSON.stringify({ op: "gt", path: "$.data.views", value: 5 })
      );
      expect(await titles(await list(`filter=${filter}`))).toEqual(["alpha"]);

      const res = await list(`sort=-${encodeURIComponent("$.data.views")}`);
      expect(await titles(res)).toEqual(["alpha", "beta"]);
    });

    test("array membership is a wildcard path", async () => {
      await seed();
      const filter = encodeURIComponent(
        JSON.stringify({ op: "eq", path: "$.data.tags[*]", value: "cms" })
      );
      expect(await titles(await list(`filter=${filter}`))).toEqual(["alpha"]);
    });

    test("the pre-D29 spellings are rejected, not reinterpreted", async () => {
      await seed();
      const legacyFilter = encodeURIComponent(
        JSON.stringify({ op: "eq", field: "title", value: "alpha" })
      );
      const res = await list(`filter=${legacyFilter}`);
      expect(res.status).toBe(400);

      const legacySort = await list(`sort=-${encodeURIComponent("$updated_at")}`);
      expect(legacySort.status).toBe(400);
    });

    test("storage-only fields stay unaddressable", async () => {
      await seed();
      for (const hidden of ["$.seq", "$.project", "$.env", "$.collection"]) {
        const filter = encodeURIComponent(JSON.stringify({ op: "eq", path: hidden, value: 1 }));
        const res = await list(`filter=${filter}`);
        expect(res.status).toBe(400);
        expect(JSON.stringify(await res.json())).toContain("not part of the entry document");
      }
    });

    test("selectors outside the subset are refused by name", async () => {
      await seed();
      for (const [path, named] of [
        ["$..title", "recursive-descent selectors"],
        ["$.data.tags[0:2]", "slice selectors"],
        ["$.data.tags[0,1]", "index-union selectors"],
        ["$.data.tags[?@.x]", "filter selectors"],
      ] as const) {
        const filter = encodeURIComponent(JSON.stringify({ op: "eq", path, value: "x" }));
        const res = await list(`filter=${filter}`);
        expect(res.status).toBe(400);
        expect(JSON.stringify(await res.json())).toContain(named);
      }
    });

    test("a wildcard cannot be a sort key", async () => {
      await seed();
      const res = await list(`sort=${encodeURIComponent("$.data.tags[*]")}`);
      expect(res.status).toBe(400);
      expect(JSON.stringify(await res.json())).toContain("no deterministic order");
    });
  });

  test("GET /api/projects/:project/envs/:env/collections/:name returns formatted data response", async () => {
    await service.collections.putSchema(Scope.Default, "deductions", {
      type: "object",
      properties: {
        section: { type: "string" },
        regime: { type: "string" },
        allowable_percentage: { type: "number" },
      },
    });

    await service.entries.create(Scope.Default, "deductions", {
      section: "80G",
      regime: "old",
      allowable_percentage: 100,
    });
    await service.entries.create(Scope.Default, "deductions", {
      section: "80G",
      regime: "new",
      allowable_percentage: 100,
    });

    const res = await app.request("/api/projects/default/environments/prod/collections/deductions");
    expect(res.status).toBe(200);

    const json = await res.json() as { data: any[]; total: number; limit: number; offset: number; items?: unknown };
    expect(json.total).toBe(2);
    expect(json.limit).toBe(50);
    expect(json.offset).toBe(0);
    expect(Array.isArray(json.data)).toBe(true);
    expect(json.items).toBeUndefined();
    expect(json.data.length).toBe(2);

    const item = json.data.find((d: any) => d.regime === "old");
    expect(item).toBeTruthy();
    expect(item.id).toBeTruthy();
    expect(item.section).toBe("80G");
    expect(item.allowable_percentage).toBe(100);
    expect(item.created_at).toBeTruthy();
    expect(item.updated_at).toBeTruthy();
    expect(item.collection).toBeUndefined();
    // rev IS exposed: PUT/DELETE demand it back as If-Match/?rev=, so a client
    // that never sees it can only guess. seq and the scope stay internal.
    expect(item.rev).toBe(1);
    expect(item.seq).toBeUndefined();
    expect(item.project).toBeUndefined();
    expect(item.env).toBeUndefined();
    expect(item.data).toBeUndefined();
  });

  test("an entry can be updated repeatedly using the rev each response returns", async () => {
    // Writes need a key, so this one runs against the full server rather than
    // the bare route table the read-shape tests use.
    const authed = new SiloServer(service, { version: "test", authDisabled: false, logger: Logger.silent() }).build();
    const secret = await service.keys.bootstrap();
    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${secret}` };
    await service.collections.putSchema(Scope.Default, "deductions", {
      type: "object",
      properties: { section: { type: "string" } },
    });

    const created = await authed.request("/api/projects/default/environments/prod/collections/deductions", {
      method: "POST",
      headers,
      body: JSON.stringify({ section: "80C" }),
    });
    expect(created.status).toBe(201);
    const first = await created.json() as any;
    expect(first.rev).toBe(1);

    const entryPath = `/api/projects/default/environments/prod/collections/deductions/${first.id}`;
    const put = async (rev: number, section: string) =>
      authed.request(entryPath, {
        method: "PUT",
        headers: { ...headers, "If-Match": `"${rev}"` },
        body: JSON.stringify({ section }),
      });

    const second = await put(first.rev, "80D");
    expect(second.status).toBe(200);
    const updated = await second.json() as any;
    expect(updated.rev).toBe(2);

    // The second edit is the one that used to 409 forever: before rev was in
    // the response the client had nothing to send but its stale first guess.
    const third = await put(updated.rev, "80G");
    expect(third.status).toBe(200);
    expect(((await third.json()) as any).rev).toBe(3);

    const stale = await put(first.rev, "80TTA");
    expect(stale.status).toBe(409);
  });

  test("a user field named rev does not shadow the envelope revision", async () => {
    await service.collections.putSchema(Scope.Default, "notes", {
      type: "object",
      properties: { rev: { type: "string" } },
    });
    await service.entries.create(Scope.Default, "notes", { rev: "draft-7" });

    const res = await app.request("/api/projects/default/environments/prod/collections/notes");
    const json = await res.json() as { data: any[] };
    expect(json.data[0].rev).toBe(1);
  });
});
