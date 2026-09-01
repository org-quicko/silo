import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { Hono } from "hono";
import { Claims } from "@silo/shared/claims";
import { SqliteStore } from "../../src/adapters/storage/sqlite/sqlite-store";
import { SiloService } from "../../src/core/services/silo-service";
import { Scope } from "../../src/core/domain/scope";
import { SiloServer } from "../../src/http/server";
import { Logger } from "../../src/logging/logger";

interface SearchBody {
  data: {
    project: string;
    env: string;
    collection: string;
    entry: Record<string, any>;
    snippets: { path: string; before: string; match: string; after: string }[];
  }[];
  total: number;
  limit: number;
  offset: number;
  truncated: boolean;
  engine: string;
}

/**
 * Both engines face the identical suite. That is the D30 parity contract made
 * executable: the same fixtures must match, `total` must respect the same
 * access boundary, and only rank order and truncation are allowed to differ —
 * so a behaviour that holds on the portable engine and not on FTS5 fails here
 * rather than in production, where FTS5 is the default.
 */
describe.each(["scan", "fts5"] as const)("search API (%s engine)", (engine) => {
  let tempDir: string;
  let store: SqliteStore;
  let service: SiloService;
  let app: Hono;
  let rootKey: string;

  const prod = Scope.Default;
  const staging = Scope.of("default", "staging");
  const acme = Scope.of("acme", "prod");

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-search-test-"));
    store = await SqliteStore.open(path.join(tempDir, "silo.db"), {
      enabled: engine === "fts5",
      tokenizer: "unicode61 remove_diacritics 2",
    });
    service = new SiloService(store, {
      mediaDir: path.join(tempDir, "media"),
      searcher: engine === "fts5" ? store.createSearcher("unicode61 remove_diacritics 2")! : undefined,
    });
    rootKey = await service.keys.bootstrap();

    await service.collections.putSchema(prod, "posts", {
      type: "object",
      "x-silo-search": { label: ["$.data.title"], exclude: ["$.data.internal"] },
    });
    await service.collections.putSchema(prod, "pages", { type: "object" });
    await service.collections.putSchema(staging, "posts", { type: "object" });
    await service.collections.putSchema(acme, "posts", { type: "object", "x-silo-auth": true });

    await service.entries.create(prod, "posts", {
      title: "Pricing changes",
      body: "We reviewed the pricing page in Café Central.",
      internal: "confidential rollout note",
    });
    await service.entries.create(prod, "posts", {
      title: "Unrelated",
      body: "Nothing about money here.",
    });
    await service.entries.create(prod, "pages", { title: "About", body: "Our pricing philosophy." });
    await service.entries.create(staging, "posts", { title: "Staging pricing draft" });
    await service.entries.create(acme, "posts", { title: "Acme pricing" });

    app = new SiloServer(service, { version: "test", authDisabled: false, logger: Logger.silent() }).build();
  });

  afterEach(async () => {
    await store.close();
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  const search = async (url: string, key?: string): Promise<SearchBody> => {
    const headers = key ? { Authorization: `Bearer ${key}` } : undefined;
    const response = await app.request(url, headers ? { headers } : undefined);
    expect(response.status).toBe(200);
    return (await response.json()) as SearchBody;
  };
  const where = (b: SearchBody) =>
    b.data.map((h) => `${h.project}/${h.env}/${h.collection}:${h.entry.title}`).sort();

  describe("the three reaches", () => {
    test("instance search crosses every project and env", async () => {
      const body = await search("/api/search?q=pricing", rootKey);
      expect(where(body)).toEqual([
        "acme/prod/posts:Acme pricing",
        "default/prod/pages:About",
        "default/prod/posts:Pricing changes",
        "default/staging/posts:Staging pricing draft",
      ]);
      expect(body.engine).toBe(engine);
      expect(body.truncated).toBe(false);
    });

    test("scope search stays inside one project and env", async () => {
      const body = await search(
        "/api/projects/default/environments/prod/search?q=pricing",
        rootKey
      );
      expect(where(body)).toEqual([
        "default/prod/pages:About",
        "default/prod/posts:Pricing changes",
      ]);
    });

    test("collection search stays inside one collection", async () => {
      const body = await search(
        "/api/projects/default/environments/prod/collections/posts/search?q=pricing",
        rootKey
      );
      expect(where(body)).toEqual(["default/prod/posts:Pricing changes"]);
    });

    test("the /envs spelling authorizes and narrows identically", async () => {
      const a = await search("/api/projects/default/envs/prod/search?q=pricing", rootKey);
      const b = await search("/api/projects/default/environments/prod/search?q=pricing", rootKey);
      expect(where(a)).toEqual(where(b));
    });

    test("a collection search is not captured by the entry-detail route", async () => {
      // `/collections/{name}/{id}` would otherwise swallow this with id="search".
      const response = await app.request(
        "/api/projects/default/environments/prod/collections/posts/search",
        { headers: { Authorization: `Bearer ${rootKey}` } }
      );
      expect(response.status).toBe(200);
      expect(((await response.json()) as SearchBody).engine).toBe(engine);
    });
  });

  describe("access is compiled before the query", () => {
    test("a key sees only what its claims cover, and total agrees", async () => {
      const { secret } = await service.keys.create("scoped", [
        Claims.collection("default", "prod", "posts", Claims.CollectionEntriesRead),
      ]);
      const body = await search("/api/search?q=pricing", secret);
      expect(where(body)).toEqual(["default/prod/posts:Pricing changes"]);
      // Not a post-filtered page: the count reflects the same boundary.
      expect(body.total).toBe(1);
    });

    test("a wildcard claim narrows to the reach rather than escaping it", async () => {
      const { secret } = await service.keys.create("wild", [
        Claims.collection("*", "*", "*", Claims.CollectionEntriesRead),
      ]);
      const body = await search(
        "/api/projects/default/environments/staging/search?q=pricing",
        secret
      );
      expect(where(body)).toEqual(["default/staging/posts:Staging pricing draft"]);
    });

    test("a key with no entry-read claim finds nothing at all", async () => {
      const { secret } = await service.keys.create("schema-only", [
        Claims.collection("*", "*", "*", Claims.CollectionSchemaRead),
      ]);
      const body = await search("/api/search?q=pricing", secret);
      expect(body.data).toEqual([]);
      expect(body.total).toBe(0);
    });

    test("anonymous search reaches public collections and not private ones", async () => {
      // `acme/prod/posts` sets x-silo-auth, so it stays out.
      const body = await search("/api/search?q=pricing");
      expect(where(body)).toEqual([
        "default/prod/pages:About",
        "default/prod/posts:Pricing changes",
        "default/staging/posts:Staging pricing draft",
      ]);
    });
  });

  describe("results", () => {
    test("a hit carries its location beside the entry, not inside it", async () => {
      const body = await search("/api/search?q=pricing%20changes", rootKey);
      const hit = body.data[0];
      expect(hit.project).toBe("default");
      expect(hit.env).toBe("prod");
      expect(hit.collection).toBe("posts");
      // §5.1 still holds for the entry itself.
      expect(hit.entry.project).toBeUndefined();
      expect(hit.entry.env).toBeUndefined();
      expect(hit.entry.seq).toBeUndefined();
      expect(hit.entry.id).toBeDefined();
      expect(hit.entry.rev).toBe(1);
    });

    test("snippets show where the match was, quoting the original text", async () => {
      const body = await search("/api/search?q=caf%C3%A9", rootKey);
      expect(body.data).toHaveLength(1);
      const snippet = body.data[0].snippets.find((s) => s.path === "$.data.body");
      expect(snippet).toBeDefined();
      // Matched folded ("cafe"), quoted unfolded ("Café") — and handed over
      // as its own field, so a highlighter never has to find it in prose that
      // may hold brackets of its own.
      expect(snippet!.match).toBe("Café");
    });

    test("no relevance score is exposed", async () => {
      const body = await search("/api/search?q=pricing", rootKey);
      expect(JSON.stringify(body)).not.toContain("score");
    });

    test("excluded fields are unsearchable but still returned on read", async () => {
      const body = await search("/api/search?q=confidential", rootKey);
      expect(body.data).toEqual([]);

      const listed = await app.request(
        "/api/projects/default/environments/prod/collections/posts",
        { headers: { Authorization: `Bearer ${rootKey}` } }
      );
      expect(JSON.stringify(await listed.json())).toContain("confidential rollout note");
    });

    test("every term must match, and the last one matches as a prefix", async () => {
      expect((await search("/api/search?q=pricing%20changes", rootKey)).total).toBe(1);
      expect((await search("/api/search?q=pricing%20absent", rootKey)).total).toBe(0);
      expect((await search("/api/search?q=pric", rootKey)).total).toBe(4);
    });
  });

  describe("filters, sort and paging", () => {
    test("a filter combines with the text query", async () => {
      const filter = encodeURIComponent(
        JSON.stringify({ op: "eq", path: "$.data.title", value: "Pricing changes" })
      );
      const body = await search(`/api/search?q=pricing&filter=${filter}`, rootKey);
      expect(where(body)).toEqual(["default/prod/posts:Pricing changes"]);
    });

    test("a filter-only search is legitimate", async () => {
      const filter = encodeURIComponent(
        JSON.stringify({ op: "exists", path: "$.data.internal" })
      );
      const body = await search(`/api/search?filter=${filter}`, rootKey);
      expect(where(body)).toEqual(["default/prod/posts:Pricing changes"]);
    });

    test("an explicit sort wins over relevance", async () => {
      const body = await search(
        `/api/search?q=pricing&sort=${encodeURIComponent("$.data.title")}`,
        rootKey
      );
      expect(body.data.map((h) => h.entry.title)).toEqual([
        "About",
        "Acme pricing",
        "Pricing changes",
        "Staging pricing draft",
      ]);
    });

    test("paging is stable and total counts the whole result set", async () => {
      const first = await search("/api/search?q=pricing&limit=2&offset=0", rootKey);
      const second = await search("/api/search?q=pricing&limit=2&offset=2", rootKey);
      expect(first.total).toBe(4);
      expect(second.total).toBe(4);
      expect(first.data).toHaveLength(2);
      expect(second.data).toHaveLength(2);
      const ids = [...first.data, ...second.data].map((h) => h.entry.id);
      expect(new Set(ids).size).toBe(4);
    });
  });

  describe("rejections", () => {
    test("a malformed path is a 400, from the search route too", async () => {
      const filter = encodeURIComponent(JSON.stringify({ op: "eq", path: "$..title", value: "x" }));
      const response = await app.request(`/api/search?filter=${filter}`, {
        headers: { Authorization: `Bearer ${rootKey}` },
      });
      expect(response.status).toBe(400);
      expect(JSON.stringify(await response.json())).toContain("recursive-descent selectors");
    });

    test("a malformed scope id is refused at the boundary", async () => {
      const response = await app.request("/api/projects/Bad_Project/environments/prod/search?q=x", {
        headers: { Authorization: `Bearer ${rootKey}` },
      });
      expect(response.status).toBe(400);
    });
  });
});
