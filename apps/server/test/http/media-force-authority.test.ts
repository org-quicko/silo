import { describe, test, expect, beforeEach, afterEach } from "bun:test";
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
 * D49: a media force-delete additionally requires `entries:update` on every
 * scope the assets being force-deleted are actually referenced from — the
 * TRUE referrer set, never the claim-filtered one a refusal's body shows the
 * caller. `media:delete` alone (D48's shipped shape) is no longer enough.
 */
describe("media force-delete authority (D49)", () => {
  let tempDir: string;
  let store: SqliteStore;
  let service: SiloService;
  let app: Hono;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-media-force-authority-"));
    store = await SqliteStore.open(path.join(tempDir, "test.db"));
    service = new SiloService(store, { mediaDir: path.join(tempDir, "media") });
    await service.keys.bootstrap();
    app = new SiloServer(service, { version: "test", authDisabled: false, logger: Logger.silent() }).build();
  });

  afterEach(async () => {
    await store.close();
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  const mint = async (claims: string[]) => (await service.keys.create("probe", claims)).secret;
  const auth = (key: string) => ({ Authorization: `Bearer ${key}` });

  const seed = async (scope: Scope = Scope.Default) => {
    await service.collections.putSchema(scope, "posts", {
      type: "object",
      properties: { cover: { type: "string", "x-silo-type": "media" } },
    });
  };

  test("media:delete alone is refused — D48's shipped shape no longer suffices", async () => {
    await seed();
    const asset = await service.media.save("used.png", new TextEncoder().encode("bytes"));
    await service.entries.create(Scope.Default, "posts", { cover: MediaRef.url(asset.id) });
    const key = await mint([Claims.MediaDelete]);

    const response = await app.request(`/api/media/${asset.id}?force=true`, {
      method: "DELETE",
      headers: auth(key),
    });
    expect(response.status).toBe(403);
    expect((await service.media.get(asset.id)).state).toBe("active");
  });

  test("refused when the key cannot see the referring scope (no entries:read there), allowed once it holds entries:update there", async () => {
    await seed();
    const asset = await service.media.save("used.png", new TextEncoder().encode("bytes"));
    await service.entries.create(Scope.Default, "posts", { cover: MediaRef.url(asset.id) });

    // A key that cannot read "default/prod/posts" at all necessarily lacks
    // entries:update there too — refusing it is the correct, self-consistent
    // outcome, not a side effect of what the 409 body would have shown it.
    const blind = await mint([Claims.MediaDelete]);
    const refused = await app.request(`/api/media/${asset.id}?force=true`, {
      method: "DELETE",
      headers: auth(blind),
    });
    expect(refused.status).toBe(403);
    expect((await service.media.get(asset.id)).state).toBe("active");

    const authorized = await mint([
      Claims.MediaDelete,
      Claims.collection("default", "prod", "posts", Claims.CollectionEntriesUpdate),
    ]);
    const allowed = await app.request(`/api/media/${asset.id}?force=true`, {
      method: "DELETE",
      headers: auth(authorized),
    });
    expect(allowed.status).toBe(204);
    await expect(service.media.get(asset.id)).rejects.toThrow();
  });

  test("entries:read on the referring scope is not enough on its own — force needs entries:update", async () => {
    await seed();
    const asset = await service.media.save("used.png", new TextEncoder().encode("bytes"));
    await service.entries.create(Scope.Default, "posts", { cover: MediaRef.url(asset.id) });

    const key = await mint([
      Claims.MediaDelete,
      Claims.collection("default", "prod", "posts", Claims.CollectionEntriesRead),
    ]);
    const response = await app.request(`/api/media/${asset.id}?force=true`, {
      method: "DELETE",
      headers: auth(key),
    });
    expect(response.status).toBe(403);
  });

  test("the 403 never names a scope the key cannot read — the 409's split, at the refusal", async () => {
    await service.scopes.createProject("secret");
    await service.scopes.createEnvironment("secret", "prod");
    const hiddenScope = Scope.of("secret", "prod");
    await seed(Scope.Default);
    await seed(hiddenScope);

    const asset = await service.media.save("used.png", new TextEncoder().encode("bytes"));
    await service.entries.create(Scope.Default, "posts", { cover: MediaRef.url(asset.id) });
    await service.entries.create(hiddenScope, "posts", { cover: MediaRef.url(asset.id) });

    // Can read "default/prod/posts" but not "secret/prod/posts", and holds
    // entries:update on neither — so both scopes are missing, one visible.
    const key = await mint([
      Claims.MediaDelete,
      Claims.collection("default", "prod", "posts", Claims.CollectionEntriesRead),
    ]);
    const response = await app.request(`/api/media/${asset.id}?force=true`, {
      method: "DELETE",
      headers: auth(key),
    });
    expect(response.status).toBe(403);

    const message = JSON.stringify(await response.json());
    expect(message).toContain("default/prod/posts");
    // The whole point of the 409's claim-filtered enumeration (§8.1): a key
    // confined to one project learns *that* a file is in use and how widely,
    // never where. A 403 that named the scope would hand it back.
    expect(message).not.toContain("secret");
    expect(message).toContain("1 scope this key cannot read");
  });

  test("an unreferenced asset needs no additional claim to force-delete — the reach is empty", async () => {
    const asset = await service.media.save("free.png", new TextEncoder().encode("bytes"));
    const key = await mint([Claims.MediaDelete]);

    const response = await app.request(`/api/media/${asset.id}?force=true`, {
      method: "DELETE",
      headers: auth(key),
    });
    expect(response.status).toBe(204);
  });

  test("bulk force-delete checks every id's referrers at once, all-or-nothing", async () => {
    await service.scopes.createProject("other");
    await service.scopes.createEnvironment("other", "prod");
    const otherScope = Scope.of("other", "prod");
    await seed(Scope.Default);
    await seed(otherScope);

    const a = await service.media.save("a.png", new TextEncoder().encode("a"));
    const b = await service.media.save("b.png", new TextEncoder().encode("b"));
    await service.entries.create(Scope.Default, "posts", { cover: MediaRef.url(a.id) });
    await service.entries.create(otherScope, "posts", { cover: MediaRef.url(b.id) });

    // Holds entries:update on "default" but not "other".
    const key = await mint([
      Claims.MediaDelete,
      Claims.collection("default", "prod", "posts", Claims.CollectionEntriesUpdate),
    ]);

    const response = await app.request("/api/media/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth(key) },
      body: JSON.stringify({ ids: [a.id, b.id], force: true }),
    });
    expect(response.status).toBe(403);
    // The authority check runs before any id in the batch is touched.
    expect((await service.media.get(a.id)).state).toBe("active");
    expect((await service.media.get(b.id)).state).toBe("active");

    const root = await mint(["*"]);
    const forced = await app.request("/api/media/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth(root) },
      body: JSON.stringify({ ids: [a.id, b.id], force: true }),
    });
    expect(forced.status).toBe(200);
    const body = (await forced.json()) as any;
    expect([...body.deleted].sort()).toEqual([a.id, b.id].sort());
  });

  test("over the enumeration cap, force is refused unless the key holds *", async () => {
    await seed();
    const asset = await service.media.save("popular.png", new TextEncoder().encode("bytes"));
    for (let index = 0; index < 2001; index++) {
      await service.entries.create(Scope.Default, "posts", { cover: MediaRef.url(asset.id) });
    }

    const key = await mint([
      Claims.MediaDelete,
      Claims.collection("default", "prod", "posts", Claims.CollectionEntriesUpdate),
    ]);
    const refused = await app.request(`/api/media/${asset.id}?force=true`, {
      method: "DELETE",
      headers: auth(key),
    });
    // Every referring row names the same scope, and that scope's claim is
    // held — but past the cap the check refuses to trust a partial page, so
    // even this key is turned away.
    expect(refused.status).toBe(403);

    const root = await mint(["*"]);
    const allowed = await app.request(`/api/media/${asset.id}?force=true`, {
      method: "DELETE",
      headers: auth(root),
    });
    expect(allowed.status).toBe(204);
  }, 60000);
});
