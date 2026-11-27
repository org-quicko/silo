import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import type { Hono } from "hono";
import { Claims } from "@silo/shared/claims";
import { MediaRef } from "@silo/shared/media-ref";
import { FsStore } from "../../src/adapters/storage/fs/fs-store";
import { PgStore } from "../../src/adapters/storage/postgres/pg-store";
import { SqliteStore } from "../../src/adapters/storage/sqlite/sqlite-store";
import { Scope } from "../../src/core/domain/scope";
import type { Storage } from "../../src/core/ports/storage";
import { SiloService } from "../../src/core/services/silo-service";
import { SiloServer } from "../../src/http/server";
import { Logger } from "../../src/logging/logger";
import { PgTestDatabase } from "../adapters/support/pg-test-database";

type StoreDriver = "sqlite" | "fs" | "postgres";

const postgres = PgTestDatabase.url() !== undefined;
if (!postgres) PgTestDatabase.skipping("SILO_TEST_PG_URL is not set");
const drivers: readonly StoreDriver[] = postgres
  ? ["sqlite", "fs", "postgres"]
  : ["sqlite", "fs"];

interface ApiEntry {
  id: string;
  rev: number;
  title: string;
  subtitle?: string;
  status?: string;
  tags?: string[];
  cover?: string | null;
  meta?: { author?: string; year?: number };
  created_at: string;
  updated_at: string;
  seq?: unknown;
  project?: unknown;
  env?: unknown;
  data?: unknown;
}

interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

const PostSchema = {
  type: "object",
  required: ["title"],
  properties: {
    title: { type: "string" },
    subtitle: { type: "string" },
    status: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
    cover: { type: "string", "x-silo-type": "media" },
    meta: {
      type: "object",
      properties: {
        author: { type: "string" },
        year: { type: "integer" },
      },
    },
  },
};

for (const driver of drivers) {
  describe(`PATCH entries API (${driver})`, () => {
    let tempDir: string;
    let store: Storage;
    let service: SiloService;
    let app: Hono;
    let rootKey: string;

    const envBase = "/api/projects/default/environments/prod/collections/posts";
    const shortBase = "/api/projects/default/envs/prod/collections/posts";

    beforeEach(async () => {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `silo-entry-patch-http-${driver}-`));
      store =
        driver === "sqlite"
          ? await SqliteStore.open(path.join(tempDir, "test.db"))
          : driver === "fs"
            ? await FsStore.open(path.join(tempDir, "data"))
            : await PgStore.open({
                url: PgTestDatabase.url()!,
                schema: PgTestDatabase.freshSchema(),
              });
      service = new SiloService(store, { mediaDir: path.join(tempDir, "media") });
      rootKey = await service.keys.bootstrap();
      await service.scopes.initDefaults(Scope.Default.project, Scope.Default.env);
      await service.collections.putSchema(Scope.Default, "posts", PostSchema);
      app = new SiloServer(service, {
        version: "test",
        authDisabled: false,
        logger: Logger.silent(),
      }).build();
    });

    afterEach(async () => {
      await store.close();
      if (store instanceof PgStore) await PgTestDatabase.drop(store.schema);
      await fs.rm(tempDir, { recursive: true, force: true });
    });

    const authHeaders = (key = rootKey, contentType = "application/merge-patch+json") => ({
      Authorization: `Bearer ${key}`,
      "Content-Type": contentType,
    });

    test("supports /environments and /envs, If-Match and ?rev=, and both JSON media types", async () => {
      const created = await service.entries.create(Scope.Default, "posts", {
        title: "First",
        subtitle: "Drop me",
        status: "draft",
        tags: ["a", "b"],
        meta: { author: "Ada", year: 2025 },
      });

      const firstPatch = await app.request(`${envBase}/${created.id}`, {
        method: "PATCH",
        headers: {
          ...authHeaders(rootKey, "application/merge-patch+json; charset=utf-8"),
          "If-Match": `"${created.rev}"`,
        },
        body: JSON.stringify({
          subtitle: null,
          tags: ["c"],
          meta: { year: 2026 },
        }),
      });
      expect(firstPatch.status).toBe(200);
      const firstBody = (await firstPatch.json()) as ApiEntry;
      expect(firstBody.id).toBe(created.id);
      expect(firstBody.rev).toBe(2);
      expect(firstBody.title).toBe("First");
      expect(firstBody.subtitle).toBeUndefined();
      expect(firstBody.status).toBe("draft");
      expect(firstBody.tags).toEqual(["c"]);
      expect(firstBody.meta).toEqual({ author: "Ada", year: 2026 });
      expect(firstBody.seq).toBeUndefined();
      expect(firstBody.project).toBeUndefined();
      expect(firstBody.env).toBeUndefined();
      expect(firstBody.data).toBeUndefined();

      const secondPatch = await app.request(`${shortBase}/${created.id}?rev=2`, {
        method: "PATCH",
        headers: authHeaders(rootKey, "application/json"),
        body: JSON.stringify({ status: "published" }),
      });
      expect(secondPatch.status).toBe(200);
      const secondBody = (await secondPatch.json()) as ApiEntry;
      expect(secondBody.rev).toBe(3);
      expect(secondBody.status).toBe("published");
      expect(secondBody.title).toBe("First");
    });

    test("requires both entries:read and entries:update claims and rejects anonymous callers", async () => {
      const entry = await service.entries.create(Scope.Default, "posts", {
        title: "Secret title",
        status: "draft",
      });

      // Anonymous callers are rejected even on a collection without x-silo-auth.
      const anon = await app.request(`${envBase}/${entry.id}?rev=1`, {
        method: "PATCH",
        headers: { "Content-Type": "application/merge-patch+json" },
        body: JSON.stringify({ status: "published" }),
      });
      expect(anon.status).toBe(401);

      const updateOnly = await service.keys.create("update-only", [
        Claims.collection("default", "prod", "posts", Claims.CollectionEntriesUpdate),
      ]);
      const updateOnlyRes = await app.request(`${shortBase}/${entry.id}?rev=1`, {
        method: "PATCH",
        headers: authHeaders(updateOnly.secret),
        body: JSON.stringify({ status: "published" }),
      });
      expect(updateOnlyRes.status).toBe(403);
      expect(((await updateOnlyRes.json()) as ApiError).error.message).toContain(
        Claims.CollectionEntriesRead,
      );

      const readOnly = await service.keys.create("read-only", [
        Claims.collection("default", "prod", "posts", Claims.CollectionEntriesRead),
      ]);
      const readOnlyRes = await app.request(`${envBase}/${entry.id}?rev=1`, {
        method: "PATCH",
        headers: authHeaders(readOnly.secret),
        body: JSON.stringify({ status: "published" }),
      });
      expect(readOnlyRes.status).toBe(403);
      expect(((await readOnlyRes.json()) as ApiError).error.message).toContain(
        Claims.CollectionEntriesUpdate,
      );

      const readAndUpdate = await service.keys.create("editor", [
        Claims.collection("default", "prod", "posts", Claims.CollectionEntriesRead),
        Claims.collection("default", "prod", "posts", Claims.CollectionEntriesUpdate),
      ]);
      const allowedRes = await app.request(`${shortBase}/${entry.id}?rev=1`, {
        method: "PATCH",
        headers: authHeaders(readAndUpdate.secret),
        body: JSON.stringify({ status: "published" }),
      });
      expect(allowedRes.status).toBe(200);
      expect(((await allowedRes.json()) as ApiEntry).title).toBe("Secret title");
    });

    test("resolves variables and media by default and preserves templates under ?variables=raw", async () => {
      await service.variables.declare(Scope.Default, "HOST", "", "https://example.com");
      const asset = await service.media.save("cover.png", new TextEncoder().encode("img"));
      const entry = await service.entries.create(Scope.Default, "posts", {
        title: "{{HOST}}/hello",
        status: "draft",
        cover: MediaRef.url(asset.id),
      });

      const resolvedRes = await app.request(`http://cms.test${envBase}/${entry.id}?rev=1`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ status: "review" }),
      });
      expect(resolvedRes.status).toBe(200);
      const resolved = (await resolvedRes.json()) as ApiEntry;
      expect(resolved.title).toBe("https://example.com/hello");
      expect(resolved.cover).toBe(`http://cms.test/media/${asset.id}`);

      const rawRes = await app.request(
        `http://cms.test${envBase}/${entry.id}?rev=2&variables=raw`,
        {
          method: "PATCH",
          headers: authHeaders(),
          body: JSON.stringify({ status: "published" }),
        },
      );
      expect(rawRes.status).toBe(200);
      const raw = (await rawRes.json()) as ApiEntry;
      expect(raw.title).toBe("{{HOST}}/hello");
      expect(raw.cover).toBe(`http://cms.test/media/${asset.id}`);

      const invalidVars = await app.request(`${envBase}/${entry.id}?rev=3&variables=false`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ status: "archived" }),
      });
      expect(invalidVars.status).toBe(400);
      expect((await service.entries.get(Scope.Default, "posts", entry.id)).rev).toBe(3);
    });

    test("rejects missing/stale rev, bad payloads, schema violations, and dangling media refs", async () => {
      const asset = await service.media.save("temp.png", new TextEncoder().encode("bytes"));
      const entry = await service.entries.create(Scope.Default, "posts", {
        title: "Keep me",
        status: "draft",
        cover: MediaRef.url(asset.id),
      });

      // Missing rev
      expect(
        (
          await app.request(`${envBase}/${entry.id}`, {
            method: "PATCH",
            headers: authHeaders(),
            body: JSON.stringify({ status: "published" }),
          })
        ).status,
      ).toBe(400);

      // Malformed rev
      expect(
        (
          await app.request(`${envBase}/${entry.id}?rev=0`, {
            method: "PATCH",
            headers: authHeaders(),
            body: JSON.stringify({ status: "published" }),
          })
        ).status,
      ).toBe(400);

      // Missing or unsupported Content-Type
      expect(
        (
          await app.request(`${envBase}/${entry.id}?rev=1`, {
            method: "PATCH",
            headers: { Authorization: `Bearer ${rootKey}` },
            body: JSON.stringify({ status: "published" }),
          })
        ).status,
      ).toBe(400);

      for (const badContentType of ["application/xml", "text/plain"]) {
        expect(
          (
            await app.request(`${envBase}/${entry.id}?rev=1`, {
              method: "PATCH",
              headers: authHeaders(rootKey, badContentType),
              body: badContentType === "application/xml" ? "<patch/>" : JSON.stringify({ status: "published" }),
            })
          ).status,
        ).toBe(400);
      }

      // Invalid JSON & empty body
      for (const badJson of ["", "{broken"]) {
        expect(
          (
            await app.request(`${envBase}/${entry.id}?rev=1`, {
              method: "PATCH",
              headers: authHeaders(),
              body: badJson,
            })
          ).status,
        ).toBe(400);
      }

      // Non-object JSON values
      for (const nonObject of ["[]", "null", '"str"', "123", "true"]) {
        expect(
          (
            await app.request(`${envBase}/${entry.id}?rev=1`, {
              method: "PATCH",
              headers: authHeaders(),
              body: nonObject,
            })
          ).status,
        ).toBe(400);
      }

      // Reserved fields
      expect(
        (
          await app.request(`${envBase}/${entry.id}?rev=1`, {
            method: "PATCH",
            headers: authHeaders(),
            body: JSON.stringify({ rev: 99 }),
          })
        ).status,
      ).toBe(400);

      // Deleting a required field via RFC 7396 `null` fails schema validation
      expect(
        (
          await app.request(`${envBase}/${entry.id}?rev=1`, {
            method: "PATCH",
            headers: authHeaders(),
            body: JSON.stringify({ title: null }),
          })
        ).status,
      ).toBe(400);

      // Stale revision
      const conflict = await app.request(`${envBase}/${entry.id}?rev=99`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ status: "published" }),
      });
      expect(conflict.status).toBe(409);

      // Dangling media ref fails even when untouched, until cleared
      await service.media.delete(asset.id, { force: true, permanent: true });
      const dangling = await app.request(`${envBase}/${entry.id}?rev=1`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ status: "published" }),
      });
      expect(dangling.status).toBe(400);

      const cleared = await app.request(`${envBase}/${entry.id}?rev=1`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ status: "published", cover: null }),
      });
      expect(cleared.status).toBe(200);
      expect(((await cleared.json()) as ApiEntry).rev).toBe(2);

      // Unknown collection, unknown entry, and system collection return 404.
      for (const missingPath of [
        "/api/projects/default/environments/prod/collections/unknown/01MISSING?rev=1",
        "/api/projects/default/environments/prod/collections/_keys/01MISSING?rev=1",
        `${envBase}/01MISSING?rev=1`,
      ]) {
        const res = await app.request(missingPath, {
          method: "PATCH",
          headers: authHeaders(),
          body: JSON.stringify({ status: "published" }),
        });
        expect(res.status).toBe(404);
      }
    });
  });
}
