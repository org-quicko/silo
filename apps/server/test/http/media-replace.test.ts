import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { Hono } from "hono";
import { Claims } from "@silo/shared/claims";
import { SqliteStore } from "../../src/adapters/storage/sqlite/sqlite-store";
import { SiloService } from "../../src/core/services/silo-service";
import { Scope } from "../../src/core/domain/scope";
import { MediaRef } from "@silo/shared/media-ref";
import { SiloServer } from "../../src/http/server";
import { Logger } from "../../src/logging/logger";

/**
 * D67: `POST /api/media/:id/content` swaps an asset's bytes without touching
 * its id, its URL, its catalog fields or any entry that refers to it.
 *
 * Two authority asks, and the tests hold both: `media:replace`, which no
 * preset but `manage` and `root` carry, and — wherever the asset is actually
 * referenced — `entries:update` at every referring scope, the same gate a
 * force delete passes (`RouteAuth.requireMediaContentAuthority`).
 */
describe("media replace (D67)", () => {
  let tempDir: string;
  let store: SqliteStore;
  let service: SiloService;
  let app: Hono;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-media-replace-"));
    store = await SqliteStore.open(path.join(tempDir, "test.db"));
    service = new SiloService(store, { mediaDir: path.join(tempDir, "media") });
    await service.keys.bootstrap();
    app = new SiloServer(service, { version: "test", authDisabled: false, logger: Logger.silent() }).build();
  });

  afterEach(async () => {
    await store.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const mint = async (claims: string[]) => (await service.keys.create("probe", claims)).secret;

  const replace = async (
    id: string,
    key: string,
    filename = "new.png",
    bytes = "replacement",
    type = "image/png"
  ) => {
    const form = new FormData();
    form.append("file", new File([new TextEncoder().encode(bytes)], filename, { type }));
    return app.request(`/api/media/${id}/content`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });
  };

  const seedCollection = async (scope: Scope = Scope.Default) => {
    await service.collections.putSchema(scope, "posts", {
      type: "object",
      properties: { cover: { type: "string", "x-silo-type": "media" } },
    });
  };

  const sha256 = (text: string) => crypto.createHash("sha256").update(text).digest("hex");

  test("keeps the id, blob key, filename, folder and URL; re-derives size, hash and type", async () => {
    const asset = await service.media.save("logo.png", new TextEncoder().encode("original"), "/brand");
    const key = await mint([Claims.MediaReplace]);

    const response = await replace(asset.id, key, "logo-v2.png", "a much longer replacement");
    expect(response.status).toBe(200);

    const body = (await response.json()) as any;
    expect(body.id).toBe(asset.id);
    expect(body.blob_key).toBe(asset.blob_key);
    expect(body.filename).toBe("logo.png");
    expect(body.folder).toBe("/brand");
    expect(body.url).toBe(asset.url);
    expect(body.size).toBe("a much longer replacement".length);
    expect(body.hash).toBe(sha256("a much longer replacement"));
    expect(body.hash).not.toBe(asset.hash);
  });

  test("the bytes actually served change, and the ETag changes with them", async () => {
    const asset = await service.media.save("logo.png", new TextEncoder().encode("original"));
    const key = await mint([Claims.MediaReplace]);

    const before = await app.request(`/media/${asset.id}`);
    expect(await before.text()).toBe("original");
    expect(before.headers.get("etag")).toBe(`"${sha256("original")}"`);

    expect((await replace(asset.id, key, "logo.png", "replacement")).status).toBe(200);

    const after = await app.request(`/media/${asset.id}`);
    expect(await after.text()).toBe("replacement");
    expect(after.headers.get("etag")).toBe(`"${sha256("replacement")}"`);
    // The old validator must not still answer 304, or a client that cached
    // the first version would never be told there is a second.
    const stale = await app.request(`/media/${asset.id}`, {
      headers: { "If-None-Match": `"${sha256("original")}"` },
    });
    expect(stale.status).toBe(200);
  });

  test("every reference survives: the entry is untouched and still resolves to the asset", async () => {
    await seedCollection();
    const asset = await service.media.save("hero.png", new TextEncoder().encode("v1"));
    const entry = await service.entries.create(Scope.Default, "posts", { cover: MediaRef.url(asset.id) });

    const key = await mint([
      Claims.MediaReplace,
      Claims.collection("default", "prod", "posts", Claims.CollectionEntriesUpdate),
    ]);
    expect((await replace(asset.id, key, "hero.png", "v2")).status).toBe(200);

    const after = await service.entries.get(Scope.Default, "posts", entry.id);
    expect((after.data as any).cover).toBe(MediaRef.url(asset.id));
    expect(after.rev).toBe(entry.rev);
    expect((await service.media.get(asset.id)).usage_count).toBe(1);
  });

  test("refuses a replacement with a different extension", async () => {
    const asset = await service.media.save("logo.png", new TextEncoder().encode("v1"));
    const key = await mint([Claims.MediaReplace]);

    const response = await replace(asset.id, key, "logo.webp", "v2", "image/webp");
    expect(response.status).toBe(400);
    expect(((await response.json()) as any).error.message).toContain(".png");
    expect((await service.media.get(asset.id)).hash).toBe(sha256("v1"));
  });

  test("refuses an extension the library's policy no longer accepts", async () => {
    const asset = await service.media.save("diagram.svg", new TextEncoder().encode("v1"));
    service.useMediaConfig({ extensions: ["png", "jpg"] });
    const key = await mint([Claims.MediaReplace]);

    const response = await replace(asset.id, key, "diagram.svg", "v2", "image/svg+xml");
    expect(response.status).toBe(400);
    expect((await service.media.get(asset.id)).hash).toBe(sha256("v1"));
  });

  test("media:create is not enough — the write preset carries it, and replace is not upload", async () => {
    const asset = await service.media.save("logo.png", new TextEncoder().encode("v1"));
    const key = await mint([Claims.MediaCreate, Claims.MediaDelete]);

    const response = await replace(asset.id, key);
    expect(response.status).toBe(403);
    expect(((await response.json()) as any).error.message).toContain(Claims.MediaReplace);
    expect((await service.media.get(asset.id)).hash).toBe(sha256("v1"));
  });

  test("an unreferenced asset needs only media:replace — the reach is empty", async () => {
    const asset = await service.media.save("orphan.png", new TextEncoder().encode("v1"));
    const key = await mint([Claims.MediaReplace]);

    expect((await replace(asset.id, key, "orphan.png", "v2")).status).toBe(200);
    expect((await service.media.get(asset.id)).hash).toBe(sha256("v2"));
  });

  test("a referenced asset additionally needs entries:update at the referring scope", async () => {
    await seedCollection();
    const asset = await service.media.save("used.png", new TextEncoder().encode("v1"));
    await service.entries.create(Scope.Default, "posts", { cover: MediaRef.url(asset.id) });

    const withoutUpdate = await mint([
      Claims.MediaReplace,
      Claims.collection("default", "prod", "posts", Claims.CollectionEntriesRead),
    ]);
    const refused = await replace(asset.id, withoutUpdate, "used.png", "v2");
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as any).error.message).toContain(Claims.CollectionEntriesUpdate);
    expect((await service.media.get(asset.id)).hash).toBe(sha256("v1"));

    const withUpdate = await mint([
      Claims.MediaReplace,
      Claims.collection("default", "prod", "posts", Claims.CollectionEntriesUpdate),
    ]);
    expect((await replace(asset.id, withUpdate, "used.png", "v2")).status).toBe(200);
    expect((await service.media.get(asset.id)).hash).toBe(sha256("v2"));
  });

  test("the refusal never names a scope the key cannot read", async () => {
    const secret = Scope.of("secret", "prod");
    await service.scopes.createProject("secret");
    await service.scopes.createEnvironment("secret", "prod");
    await seedCollection();
    await seedCollection(secret);

    const asset = await service.media.save("shared.png", new TextEncoder().encode("v1"));
    await service.entries.create(Scope.Default, "posts", { cover: MediaRef.url(asset.id) });
    await service.entries.create(secret, "posts", { cover: MediaRef.url(asset.id) });

    const key = await mint([
      Claims.MediaReplace,
      Claims.collection("default", "prod", "posts", Claims.CollectionEntriesRead),
    ]);
    const response = await replace(asset.id, key, "shared.png", "v2");
    expect(response.status).toBe(403);

    const message = ((await response.json()) as any).error.message as string;
    expect(message).toContain("default/prod/posts");
    expect(message).not.toContain("secret");
    expect(message).toContain("1 scope this key cannot read");
  });

  test("refuses while the asset is staged for deletion", async () => {
    const asset = await service.media.save("going.png", new TextEncoder().encode("v1"));
    // Stage the asset the way a crashed delete would leave it.
    await service.media.update(asset.id, {});
    const staged = await store.get(Scope.System, "_media", asset.id);
    await store.put(
      { ...staged, rev: staged.rev + 1, data: { ...staged.data, state: "deleting" } },
      { usages: [], search: null }
    );

    const key = await mint([Claims.MediaReplace]);
    expect((await replace(asset.id, key, "going.png", "v2")).status).toBe(409);
  });

  test("404s for an id that does not exist, rather than leaking it through the reach check", async () => {
    const key = await mint([Claims.MediaReplace]);
    expect((await replace("01ARZ3NDEKTSV4RRFFQ69G5FAV", key)).status).toBe(404);
  });

  test("refuses a request with no file part", async () => {
    const asset = await service.media.save("logo.png", new TextEncoder().encode("v1"));
    const key = await mint([Claims.MediaReplace]);

    const response = await app.request(`/api/media/${asset.id}/content`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: new FormData(),
    });
    expect(response.status).toBe(400);
  });
});
