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
import { TrashHeader } from "../../src/http/routes/trash-header";
import { Logger } from "../../src/logging/logger";

interface TrashPageBody {
  items: Array<{
    id: string;
    kind: string;
    subject_name: string;
    origin: { collection_name?: string };
    restorable: boolean;
    blocked_by?: { kind: string; trash_id: string | null };
  }>;
  total: number;
}

/**
 * D113's authority rules, which are the part of the trash worth pinning: reading
 * is filtered per caller rather than gated on a claim, restoring asks for the
 * write claims at the destination, and only purging has a claim of its own.
 */
describe("trash API (D113)", () => {
  let tempDir: string;
  let store: SqliteStore;
  let service: SiloService;
  let app: Hono;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-trash-api-"));
    store = await SqliteStore.open(path.join(tempDir, "test.db"));
    service = new SiloService(store, { mediaDir: path.join(tempDir, "media") });
    await service.keys.bootstrap();
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

  const mint = async (claims: string[]) => (await service.keys.create("probe", claims)).secret;
  const auth = (key: string) => ({ Authorization: `Bearer ${key}` });

  const seed = async (scope: Scope = Scope.Default, name = "posts") => {
    await service.collections.putSchema(scope, name, {
      type: "object",
      properties: { title: { type: "string" } },
    });
  };

  /** Deletes one entry and answers the receipt the route reported. */
  const trashAnEntry = async (scope = Scope.Default, name = "posts") => {
    const entry = await service.entries.create(scope, name, { title: "doomed" });
    await service.entries.delete(scope, name, entry.id, entry.rev);
    return entry;
  };

  test("listing is filtered by the read claim the origin already required", async () => {
    await seed();
    await seed(Scope.of("other", "prod"), "notes");
    await trashAnEntry();
    await trashAnEntry(Scope.of("other", "prod"), "notes");

    const narrow = await mint([
      Claims.collection("default", "prod", "posts", Claims.CollectionEntriesRead),
    ]);
    const response = await app.request("/api/trash", { headers: auth(narrow) });
    expect(response.status).toBe(200);

    const body = (await response.json()) as TrashPageBody;
    expect(body.items).toHaveLength(1);
    expect(body.items[0].kind).toBe("entry");
    // `total` counts what this caller may see; reporting two would disclose the
    // other deletion by arithmetic.
    expect(body.total).toBe(1);
  });

  test("a key that can read nothing sees an empty trash, not a 403", async () => {
    await seed();
    await trashAnEntry();

    const blind = await mint([Claims.MediaCreate]);
    const response = await app.request("/api/trash", { headers: auth(blind) });
    expect(response.status).toBe(200);
    expect(((await response.json()) as TrashPageBody).total).toBe(0);
  });

  test("one item a caller may not see answers 404, not 403", async () => {
    await seed();
    await trashAnEntry();
    const id = (await service.trash.list()).items[0].id;

    const blind = await mint([Claims.MediaCreate]);
    const response = await app.request(`/api/trash/${id}`, { headers: auth(blind) });
    expect(response.status).toBe(404);
  });

  test("restoring asks for the write claim at the destination, not a claim of its own", async () => {
    await seed();
    const entry = await trashAnEntry();
    const id = (await service.trash.list()).items[0].id;

    const readOnly = await mint([
      Claims.collection("default", "prod", "posts", Claims.CollectionEntriesRead),
    ]);
    const refused = await app.request(`/api/trash/${id}/restore`, {
      method: "POST",
      headers: auth(readOnly),
    });
    expect(refused.status).toBe(403);

    const writer = await mint([
      Claims.collection("default", "prod", "posts", Claims.CollectionEntriesRead),
      Claims.collection("default", "prod", "posts", Claims.CollectionEntriesCreate),
    ]);
    const allowed = await app.request(`/api/trash/${id}/restore`, {
      method: "POST",
      headers: auth(writer),
    });
    expect(allowed.status).toBe(200);
    expect(await service.entries.get(Scope.Default, "posts", entry.id)).toBeTruthy();
  });

  test("a restore checks the names the destination has now, not the ones it had at delete", async () => {
    await seed();
    const entry = await trashAnEntry();
    const id = (await service.trash.list()).items[0].id;
    await service.renames.renameCollection(Scope.Default, "posts", "articles", { kind: "cli" });

    const oldName = await mint([
      Claims.collection("default", "prod", "posts", Claims.CollectionEntriesRead),
      Claims.collection("default", "prod", "posts", Claims.CollectionEntriesCreate),
    ]);
    // The old name now names nothing this key may read, so the item is not
    // there for it at all.
    const refused = await app.request(`/api/trash/${id}/restore`, {
      method: "POST",
      headers: auth(oldName),
    });
    expect(refused.status).toBe(404);

    const newName = await mint([
      Claims.collection("default", "prod", "articles", Claims.CollectionEntriesRead),
      Claims.collection("default", "prod", "articles", Claims.CollectionEntriesCreate),
    ]);
    const listed = await app.request("/api/trash?collection=articles", { headers: auth(newName) });
    const body = (await listed.json()) as TrashPageBody;
    expect(body.items.map((item) => item.origin.collection_name)).toEqual(["articles"]);

    const allowed = await app.request(`/api/trash/${id}/restore`, {
      method: "POST",
      headers: auth(newName),
    });
    expect(allowed.status).toBe(200);
    expect(await service.entries.get(Scope.Default, "articles", entry.id)).toBeTruthy();
  });

  test("a restore under another name asks for the claims at that name", async () => {
    await seed();
    await service.collections.delete(Scope.Default, "posts", true);
    const id = (await service.trash.list()).items[0].id;

    const atPosts = await mint([
      Claims.collection("default", "prod", "posts", Claims.CollectionSchemaRead),
      Claims.collection("default", "prod", "posts", Claims.CollectionCreate),
      Claims.collection("default", "prod", "posts", Claims.CollectionEntriesCreate),
    ]);
    const restore = (rename?: string) =>
      app.request(`/api/trash/${id}/restore`, {
        method: "POST",
        headers: { ...auth(atPosts), "Content-Type": "application/json" },
        body: JSON.stringify(rename ? { rename } : {}),
      });

    expect((await restore("elsewhere")).status).toBe(403);
    expect((await restore()).status).toBe(200);
  });

  test("purging needs trash:purge, and emptying needs the typed confirmation", async () => {
    await seed();
    await trashAnEntry();
    const id = (await service.trash.list()).items[0].id;

    const deleter = await mint([
      Claims.collection("default", "prod", "posts", Claims.CollectionEntriesRead),
      Claims.collection("default", "prod", "posts", Claims.CollectionEntriesDelete),
    ]);
    expect(
      (await app.request(`/api/trash/${id}`, { method: "DELETE", headers: auth(deleter) })).status
    ).toBe(403);

    const purger = await mint([
      Claims.collection("default", "prod", "posts", Claims.CollectionEntriesRead),
      Claims.TrashPurge,
    ]);
    expect(
      (await app.request(`/api/trash/${id}`, { method: "DELETE", headers: auth(purger) })).status
    ).toBe(204);
    expect((await service.trash.list()).total).toBe(0);

    await trashAnEntry();
    const missingConfirmation = await app.request("/api/trash/purge", {
      method: "POST",
      headers: { ...auth(purger), "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(missingConfirmation.status).toBe(400);

    const emptied = await app.request("/api/trash/purge", {
      method: "POST",
      headers: { ...auth(purger), "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: "empty" }),
    });
    expect(emptied.status).toBe(200);
    expect((await service.trash.list()).total).toBe(0);
  });

  test("?permanent=true skips the trash and asks for trash:purge", async () => {
    await seed();
    const entry = await service.entries.create(Scope.Default, "posts", { title: "gone" });

    const deleter = await mint([
      Claims.collection("default", "prod", "posts", Claims.CollectionEntriesDelete),
    ]);
    const refused = await app.request(
      `/api/projects/default/envs/prod/collections/posts/${entry.id}?rev=${entry.rev}&permanent=true`,
      { method: "DELETE", headers: auth(deleter) }
    );
    expect(refused.status).toBe(403);

    const purger = await mint([
      Claims.collection("default", "prod", "posts", Claims.CollectionEntriesDelete),
      Claims.TrashPurge,
    ]);
    const allowed = await app.request(
      `/api/projects/default/envs/prod/collections/posts/${entry.id}?rev=${entry.rev}&permanent=true`,
      { method: "DELETE", headers: auth(purger) }
    );
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get(TrashHeader.Name)).toBeNull();
    expect((await service.trash.list()).total).toBe(0);
  });

  test("an ordinary delete answers its receipt in a header, so the admin can offer undo", async () => {
    await seed();
    const entry = await service.entries.create(Scope.Default, "posts", { title: "oops" });
    const deleter = await mint([
      Claims.collection("default", "prod", "posts", Claims.CollectionEntriesRead),
      Claims.collection("default", "prod", "posts", Claims.CollectionEntriesDelete),
    ]);

    const response = await app.request(
      `/api/projects/default/envs/prod/collections/posts/${entry.id}?rev=${entry.rev}`,
      { method: "DELETE", headers: auth(deleter) }
    );
    expect(response.status).toBe(204);

    const receipt = response.headers.get(TrashHeader.Name);
    expect(receipt).toBeTruthy();
    const item = await app.request(`/api/trash/${receipt}`, { headers: auth(deleter) });
    expect(item.status).toBe(200);
  });

  test("a folder delete answers its one receipt in the header, recursive or not", async () => {
    await service.media.save("a.png", new TextEncoder().encode("bytes"), "/shoots/raw");
    await service.media.save("b.png", new TextEncoder().encode("bytes"), "/shoots");
    const deleter = await mint([Claims.MediaDelete]);

    const recursive = await app.request("/api/media/folders?path=%2Fshoots&recursive=true", {
      method: "DELETE",
      headers: auth(deleter),
    });
    expect(recursive.status).toBe(200);
    const receipt = recursive.headers.get(TrashHeader.Name);
    expect((await service.trash.list()).items.map((item) => item.id)).toEqual([receipt!]);

    await service.media.createFolder("/drafts");
    const empty = await app.request("/api/media/folders?path=%2Fdrafts", {
      method: "DELETE",
      headers: auth(deleter),
    });
    expect(empty.status).toBe(204);
    expect(empty.headers.get(TrashHeader.Name)).toBeTruthy();
  });

  test("the session says whether deletes are recoverable, so a dialog can too", async () => {
    const key = await mint([Claims.MediaCreate]);
    const response = await app.request("/api/session", { headers: auth(key) });
    const body = (await response.json()) as { trash: { enabled: boolean; retention_days: number } };
    expect(body.trash).toEqual({ enabled: true, retention_days: 30 });
  });

  test("a blocked item names the receipt that would unblock it", async () => {
    await seed();
    await trashAnEntry();
    await service.collections.delete(Scope.Default, "posts", true);

    const root = await mint([Claims.Root]);
    const response = await app.request("/api/trash?kind=entry", { headers: auth(root) });
    const body = (await response.json()) as TrashPageBody;

    expect(body.items[0].restorable).toBe(false);
    expect(body.items[0].blocked_by?.kind).toBe("collection");
    expect(body.items[0].blocked_by?.trash_id).toBeTruthy();
  });
});
