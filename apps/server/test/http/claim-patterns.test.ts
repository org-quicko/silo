import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { Hono } from "hono";
import { Claims } from "@silo/shared/claims";
import { SqliteStore } from "../../src/adapters/storage/sqlite/sqlite-store";
import { SiloService } from "../../src/core/services/silo-service";
import { Scope } from "../../src/core/domain/scope";
import { SiloServer } from "../../src/http/server";
import { Logger } from "../../src/logging/logger";

interface ProjectsBody {
  items: { name: string }[];
}

interface SearchBody {
  data: { project: string; env: string; collection: string }[];
  total: number;
}

interface KeyBody {
  claims: string[];
}

/**
 * Prefix patterns in a claim's scope segments (D64).
 *
 * The suite runs against **both** search engines for the reason D30's parity
 * contract exists: the SQLite plan compiles a pattern to `GLOB` and the
 * portable scanner compares in TypeScript, so a pattern that reads one row too
 * many on one of them is an authorization bug that no 403 would ever reveal.
 */
describe.each(["scan", "fts5"] as const)("claim prefix patterns (%s engine)", (engine) => {
  let tempDir: string;
  let store: SqliteStore;
  let service: SiloService;
  let app: Hono;
  let rootKey: string;

  const scopes = [
    Scope.of("acme-web", "prod"),
    Scope.of("acme-api", "prod"),
    Scope.of("beta-web", "prod"),
  ];

  const headersFor = (secret: string) => ({
    Authorization: `Bearer ${secret}`,
    "Content-Type": "application/json",
  });

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-claim-pattern-test-"));
    store = await SqliteStore.open(path.join(tempDir, "silo.db"), {
      enabled: engine === "fts5",
      tokenizer: "unicode61 remove_diacritics 2",
    });
    service = new SiloService(store, {
      mediaDir: path.join(tempDir, "media"),
      searcher:
        engine === "fts5" ? store.createSearcher("unicode61 remove_diacritics 2")! : undefined,
    });
    rootKey = await service.keys.bootstrap();

    for (const scope of scopes) {
      await service.collections.putSchema(scope, "posts", {
        type: "object",
        "x-silo-auth": true,
      });
      await service.entries.create(scope, "posts", { title: "kingfisher" });
    }

    app = new SiloServer(service, {
      version: "test",
      authDisabled: false,
      logger: Logger.silent(),
    }).build();
  });

  afterEach(async () => {
    await store.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  /** A key that owns the `acme-` namespace and nothing else. */
  const namespaceKey = () =>
    service.keys.create("acme-owner", [
      Claims.collection("acme*", "prod", "*", Claims.CollectionSchemaRead),
      Claims.collection("acme*", "prod", "*", Claims.CollectionEntriesRead),
    ]);

  test("reads the collections under the prefix", async () => {
    const { secret } = await namespaceKey();
    for (const project of ["acme-web", "acme-api"]) {
      const response = await app.request(
        `/api/projects/${project}/environments/prod/collections/posts/schema`,
        { headers: headersFor(secret) },
      );
      expect(response.status).toBe(200);
    }
  });

  test("reads nothing outside it", async () => {
    const { secret } = await namespaceKey();
    const response = await app.request(
      "/api/projects/beta-web/environments/prod/collections/posts/schema",
      { headers: headersFor(secret) },
    );
    expect(response.status).toBe(403);
  });

  test("does not leak across the environment segment", async () => {
    await service.collections.putSchema(Scope.of("acme-web", "dev"), "posts", {
      type: "object",
      "x-silo-auth": true,
    });
    const { secret } = await namespaceKey();
    const response = await app.request(
      "/api/projects/acme-web/environments/dev/collections/posts/schema",
      { headers: headersFor(secret) },
    );
    expect(response.status).toBe(403);
  });

  test("sees only the projects under the prefix", async () => {
    const { secret } = await namespaceKey();
    const body = (await (
      await app.request("/api/projects", { headers: headersFor(secret) })
    ).json()) as ProjectsBody;

    expect(body.items.map((item) => item.name).sort()).toEqual(["acme-api", "acme-web"]);
  });

  /** The plan bounds the query, so `total` has to respect the pattern too: a
   *  count that included `beta-web` would disclose it exists. */
  test("searches only the scopes under the prefix, count included", async () => {
    const { secret } = await namespaceKey();
    const body = (await (
      await app.request("/api/search?q=kingfisher", { headers: headersFor(secret) })
    ).json()) as SearchBody;

    expect(body.total).toBe(2);
    expect(body.data.map((hit) => hit.project).sort()).toEqual(["acme-api", "acme-web"]);
  });

  test("a scoped search inside the prefix still works", async () => {
    const { secret } = await namespaceKey();
    const body = (await (
      await app.request("/api/projects/acme-web/environments/prod/search?q=kingfisher", {
        headers: headersFor(secret) },
      )
    ).json()) as SearchBody;

    expect(body.total).toBe(1);
    expect(body.data[0].project).toBe("acme-web");
  });

  /**
   * A search the caller cannot reach answers *empty*, not 403 — the same as a
   * literal claim does, which is the property being pinned here. The engines
   * compile a pattern differently (GLOB against the index, a comparison in
   * TypeScript), so what matters is that neither turns a pattern into a wider
   * plan than the equivalent literal.
   */
  test("a scoped search outside the prefix finds nothing, exactly as a literal does", async () => {
    const pattern = await namespaceKey();
    const literal = await service.keys.create("acme-web-only", [
      Claims.collection("acme-web", "prod", "*", Claims.CollectionSchemaRead),
      Claims.collection("acme-web", "prod", "*", Claims.CollectionEntriesRead),
    ]);
    const url = "/api/projects/beta-web/environments/prod/search?q=kingfisher";

    for (const secret of [pattern.secret, literal.secret]) {
      const response = await app.request(url, { headers: headersFor(secret) });
      expect(response.status).toBe(200);
      const body = (await response.json()) as SearchBody;
      expect(body.total).toBe(0);
      expect(body.data).toEqual([]);
    }
  });

  test("a pattern holder may mint under its prefix and not beside it", async () => {
    const { secret } = await service.keys.create("acme-owner", [
      Claims.KeysCreate,
      Claims.collection("acme*", "prod", "*", Claims.CollectionEntriesRead),
    ]);

    const narrower = await app.request("/api/keys", {
      method: "POST",
      headers: headersFor(secret),
      body: JSON.stringify({
        label: "web only",
        claims: [Claims.collection("acme-web", "prod", "*", Claims.CollectionEntriesRead)],
      }),
    });
    expect(narrower.status).toBe(201);
    expect(((await narrower.json()) as KeyBody).claims).toEqual([
      Claims.collection("acme-web", "prod", "*", Claims.CollectionEntriesRead),
    ]);

    const wider = await app.request("/api/keys", {
      method: "POST",
      headers: headersFor(secret),
      body: JSON.stringify({
        label: "everything",
        claims: [Claims.collection("*", "prod", "*", Claims.CollectionEntriesRead)],
      }),
    });
    expect(wider.status).toBe(403);
  });

  test("a prefix in the collection segment bounds a single scope", async () => {
    const scope = Scope.of("acme-web", "prod");
    for (const name of ["cms_pages", "internal_notes"]) {
      await service.collections.putSchema(scope, name, { type: "object", "x-silo-auth": true });
    }

    const { secret } = await service.keys.create("cms-reader", [
      Claims.collection("acme-web", "prod", "cms_*", Claims.CollectionSchemaRead),
    ]);
    const headers = headersFor(secret);
    const url = (name: string) =>
      `/api/projects/acme-web/environments/prod/collections/${name}/schema`;

    expect((await app.request(url("cms_pages"), { headers })).status).toBe(200);
    expect((await app.request(url("internal_notes"), { headers })).status).toBe(403);
  });

  test("the root key is unaffected by any of it", async () => {
    const body = (await (
      await app.request("/api/search?q=kingfisher", { headers: headersFor(rootKey) })
    ).json()) as SearchBody;
    expect(body.total).toBe(3);
  });
});
