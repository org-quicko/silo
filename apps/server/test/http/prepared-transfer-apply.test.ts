import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import path from "path";
import { Claims } from "@silo/shared/claims";
import { MediaRef } from "@silo/shared/media-ref";
import { FsBlobStorage } from "../../src/adapters/blob/fs-blob-storage";
import { S3BlobStorage } from "../../src/adapters/blob/s3-blob-storage";
import { PgStore } from "../../src/adapters/storage/postgres/pg-store";
import { Scope } from "../../src/core/domain/scope";
import { NotFoundError } from "../../src/core/errors/not-found-error";
import { MediaCatalog } from "../../src/core/media/media-catalog";
import { S3MockServer } from "../adapters/s3-mock-server";
import { PgTestDatabase } from "../adapters/support/pg-test-database";
import { TransferPair } from "./support/transfer-pair";

/** A response body as JSON, untyped: each assertion says what it holds. */
const read = async (response: { json(): Promise<unknown> } | Promise<{ json(): Promise<unknown> }>): Promise<any> =>
  (await response).json();

/**
 * Applying a prepared transfer (D111): the plan lands as one commit with its
 * ledger row, or nothing lands; the destination's own media is never
 * changed; and an apply that cannot land leaves no file behind.
 */
describe("applying a prepared transfer", () => {
  let pair: TransferPair;
  const uat = Scope.of("acme", "uat");

  beforeEach(async () => {
    pair = await TransferPair.open();
    await pair.seed();
  });

  afterEach(async () => {
    await pair.close();
  });

  const route = (id: string) => `${TransferPair.Prepare}/${id}`;
  const prepared = async (overrides: Record<string, unknown> = {}, on = pair) => {
    const answer = await on.prepare(on.body(overrides));
    expect(answer.status).toBe(201);
    return read(answer);
  };
  const absent = async (attempt: Promise<unknown>) => expect(attempt).rejects.toBeInstanceOf(NotFoundError);

  test("writes exactly the plan into this environment, once", async () => {
    const { picked, other, home, asset } = pair.seeded;
    const view = await prepared();
    const applied = await pair.apply(view.id);
    expect(applied.status).toBe(200);
    const done = await read(applied);
    expect(done).toMatchObject({ state: "applied", applied_at: expect.any(String), review: { added: 2 } });

    const { store, blobStorage } = pair.destinationService;
    const post = await store.get(uat, "posts", picked);
    expect(post).toMatchObject({ rev: 1, data: { title: "picked", cover: MediaRef.url(asset) } });
    expect((await store.get(uat, "pages", home)).data).toEqual({ title: "home" });
    await absent(store.get(uat, "posts", other));
    expect(await store.listCollections(Scope.of("acme", "dev"))).toEqual([]);
    const stored = MediaCatalog.toAsset(await store.get(Scope.System, MediaCatalog.Collection, asset));
    expect(stored).toMatchObject({ filename: "used.png", folder: "/a", state: "active" });
    expect(new TextDecoder().decode((await blobStorage.get(stored.blob_key))!.data)).toBe("used");
    expect((await store.countMediaUsages([asset])).get(asset)).toBe(1);
    const folders = await store.list(Scope.System, MediaCatalog.FoldersCollection, { limit: 10, offset: 0 });
    expect(folders.items.map((folder) => folder.data.path)).toEqual(["/a"]);
    expect((await store.get(Scope.System, "_transfers", view.id)).data).toMatchObject({ from: { env: "dev" }, to: { env: "uat" }, added: 2 });

    // Again: the same answer, and nothing written twice.
    expect(await read(pair.apply(view.id))).toEqual(done);
    expect((await store.get(uat, "posts", picked)).seq).toBe(post.seq);
    expect(await pair.transferDirectories()).toEqual([view.id]);
  });

  test("refuses a plan this server moved under, and writes nothing", async () => {
    const { picked, asset } = pair.seeded;
    const destination = pair.destinationService;
    await destination.collections.putSchema(uat, "posts", { type: "object" });
    const cases: [string, () => Promise<unknown>, Record<string, unknown>][] = [
      ["an entry it adds now exists", () => pair.plant("uat", "posts", picked, "2020-01-01T00:00:00Z"), {}],
      ["a collection it creates now exists", () => destination.collections.putSchema(uat, "pages", { type: "object" }), {}],
      ["a folder it adds now exists", () => destination.media.createFolder("/a"), {}],
      ["a file it writes now exists", () => destination.blobStorage.put(`media/${asset}`, new Uint8Array([1])), {}],
      ["an asset a reference resolved to is gone", () => destination.store.delete(Scope.System, MediaCatalog.Collection, asset), { media: "none" }],
    ];
    for (const [name, change, overrides] of cases) {
      // Each case starts with the asset absent, except the one about a reference to it.
      if (name.startsWith("an asset")) await pair.plantAsset(asset, "used");
      else await destination.store.delete(Scope.System, MediaCatalog.Collection, asset).catch(() => {});
      await destination.blobStorage.delete(`media/${asset}`);
      const view = await prepared(overrides);
      await change();
      const before = await pair.snapshot();
      const refused = await pair.apply(view.id);
      expect([name, refused.status, (await read(refused)).error.code]).toEqual([name, 409, "stale_preview"]);
      expect([name, await pair.snapshot()]).toEqual([name, before]);
      expect([name, (await read(pair.call("GET", route(view.id)))).state]).toEqual([name, "stale"]);
    }
  });

  test("refuses an environment deleted or recreated since the plan, and never recreates it", async () => {
    const { scopes, store } = pair.destinationService;
    for (const recreated of [false, true]) {
      const view = await prepared();
      const planned = (await store.findEnvironment("acme", "uat"))!.id;
      await scopes.deleteEnvironment("acme", "uat", true);
      if (recreated) await scopes.createEnvironment("acme", "uat");
      const refused = await pair.apply(view.id);
      expect([recreated, refused.status, (await read(refused)).error.code]).toEqual([recreated, 409, "stale_preview"]);
      const now = await store.findEnvironment("acme", "uat");
      expect([recreated, now === null, now?.id === planned]).toEqual([recreated, !recreated, false]);
      if (now) expect(await store.listCollections(uat)).toEqual([]);
      else await scopes.createEnvironment("acme", "uat");
    }
  });

  test("keeps every asset this server already has, as it is", async () => {
    const { asset } = pair.seeded;
    const { store, blobStorage } = pair.destinationService;
    const cases: [string, string, Record<string, unknown>, string, string?][] = [
      ["the same file", "used", {}, "unchanged"],
      ["other bytes", "USED", {}, "skipped", "other bytes"],
      ["another filename", "used", { filename: "renamed.png" }, "skipped", "another filename"],
      ["being deleted", "used", { state: "deleting" }, "skipped", "deleting"],
    ];
    for (const [name, bytes, details, action, reason] of cases) {
      await pair.plantAsset(asset, bytes, details);
      const before = await store.get(Scope.System, MediaCatalog.Collection, asset);
      const view = await prepared();
      const line = view.entries.items.find((item: any) => item.collection === MediaCatalog.Collection);
      expect([name, line.action, line.reason ?? ""]).toEqual([name, action, reason ? expect.stringContaining(reason) : ""]);
      expect([name, (await pair.apply(view.id)).status]).toEqual([name, 200]);
      expect([name, await store.get(Scope.System, MediaCatalog.Collection, asset)]).toEqual([name, before]);
      expect([name, new TextDecoder().decode((await blobStorage.get(`media/${asset}`))!.data)]).toEqual([name, bytes]);
    }
  });

  test("a file no asset here claims, at the asset's key, is left as it is, and the rest applies", async () => {
    const { picked, asset } = pair.seeded;
    const { store, blobStorage } = pair.destinationService;
    await blobStorage.put(`media/${asset}`, new TextEncoder().encode("orphan"));
    const view = await prepared();
    expect(view.entries.items.find((item: any) => item.collection === MediaCatalog.Collection)).toMatchObject({
      action: "skipped",
      reason: expect.stringContaining("already has a file"),
    });
    expect(view.entries.items.find((item: any) => item.id === picked)).toMatchObject({ unresolved: [asset] });

    expect((await pair.apply(view.id)).status).toBe(200);
    expect(new TextDecoder().decode((await blobStorage.get(`media/${asset}`))!.data)).toBe("orphan");
    await absent(store.get(Scope.System, MediaCatalog.Collection, asset));
    expect((await store.get(uat, "posts", picked)).data.cover).toBe(MediaRef.url(asset));
  });

  test("replace removes the rows it does not carry, and never media", async () => {
    await pair.destinationService.collections.putSchema(uat, "pages", { type: "object" });
    const stray = (await pair.destinationService.entries.create(uat, "pages", { title: "stray" })).id;
    const kept = (await pair.destinationService.media.save("kept.png", new TextEncoder().encode("kept"))).id;

    const view = await prepared({ mode: "replace", selection: [{ collection: "pages" }] });
    expect((await pair.apply(view.id)).status).toBe(200);
    await absent(pair.destinationService.store.get(uat, "pages", stray));
    expect((await pair.destinationService.store.get(uat, "pages", pair.seeded.home)).data).toEqual({ title: "home" });
    expect(MediaCatalog.toAsset(await pair.destinationService.store.get(Scope.System, MediaCatalog.Collection, kept)).state).toBe("active");
  });

  test("with no media, writes each reference as it is and says which will not resolve", async () => {
    const { picked, asset } = pair.seeded;
    const view = await prepared({ media: "none" });
    expect(view.review.media).toEqual({ added: 0, unchanged: 0, skipped: 0, folders_added: 0, unresolved: [asset] });
    expect(view.entries.items.find((item: any) => item.id === picked)).toMatchObject({ unresolved: [asset] });

    expect((await pair.apply(view.id)).status).toBe(200);
    expect((await pair.destinationService.store.get(uat, "posts", picked)).data.cover).toBe(MediaRef.url(asset));
    await absent(pair.destinationService.store.get(Scope.System, MediaCatalog.Collection, asset));
    expect(await pair.destinationService.blobStorage.list()).toEqual([]);
  });

  test("asks for the claims again when it applies", async () => {
    const writes = ["posts", "pages"].flatMap((name) =>
      Claims.ScopeCopyWritePermissions.map((permission) => Claims.collection("acme", "uat", name, permission))
    );
    const granted = [Claims.TransferCopy, Claims.MediaCreate, ...writes];
    const key = await pair.destinationService.keys.create("releaser", granted);
    const view = await read(pair.prepare(pair.body(), key.secret));

    await pair.destinationService.keys.update(key.entry.id, { claims: granted.filter((claim) => claim !== Claims.MediaCreate) });
    expect((await pair.apply(view.id, key.secret)).status).toBe(403);
    expect((await read(pair.call("GET", route(view.id), key.secret))).state).toBe("prepared");

    await pair.destinationService.keys.update(key.entry.id, { claims: granted });
    expect((await pair.apply(view.id, key.secret)).status).toBe(200);
  });

  test("while one apply runs, another is told so, and only one writes", async () => {
    await pair.close();
    const reached = Promise.withResolvers<void>();
    const gate = Promise.withResolvers<void>();
    pair = await TransferPair.open({
      blobs: (directory) => {
        const files = new FsBlobStorage(path.join(directory, "destination-media"));
        const put = files.put.bind(files);
        files.put = async (...args) => {
          reached.resolve();
          await gate.promise;
          return put(...args);
        };
        return files;
      },
    });
    await pair.seed();

    const view = await prepared();
    const first = pair.apply(view.id);
    await reached.promise;
    const second = await pair.apply(view.id);
    expect([second.status, (await read(second)).error.code]).toEqual([409, "transfer_in_progress"]);
    expect((await pair.call("DELETE", route(view.id))).status).toBe(409);
    gate.resolve();
    expect((await first).status).toBe(200);
    const ledger = await pair.destinationService.store.list(Scope.System, "_transfers", { limit: 10, offset: 0 });
    expect(ledger.items.map((row) => row.id)).toEqual([view.id]);
  });

  test("a file store that fails part way keeps no file of the transfer", async () => {
    await pair.close();
    const s3 = S3MockServer.start();
    try {
      const blobs = new S3BlobStorage({ bucket: S3MockServer.Bucket, endpoint: s3.endpoint, accessKeyId: "test", secretAccessKey: "test", forcePathStyle: true });
      pair = await TransferPair.open({ blobs: () => blobs });
      await pair.seed();
      const dev = Scope.of("acme", "dev");
      const second = await pair.sourceService.media.save("second.png", new TextEncoder().encode("second"), "/a");
      await pair.sourceService.entries.create(dev, "pages", { title: "gallery", cover: MediaRef.url(second.id) });
      const view = await prepared();
      expect(view.review.media.added).toBe(2);

      // The second of the two puts fails.
      s3.refusesPut = (key) => key === `media/${second.id}`;
      const before = await pair.snapshot();
      expect((await pair.apply(view.id)).status).toBe(500);
      expect([...s3.objects.keys()]).toEqual([]);
      expect(await pair.snapshot()).toEqual(before);
      expect(await read(pair.call("GET", route(view.id)))).toMatchObject({ state: "prepared", last_error: expect.any(String) });

      s3.refusesPut = () => false;
      expect((await pair.apply(view.id)).status).toBe(200);
      expect([...s3.objects.keys()].sort()).toEqual([`media/${pair.seeded.asset}`, `media/${second.id}`].sort());
    } finally {
      s3.stop();
    }
  });
});

/**
 * A commit that fails inside itself, on each store that offers one: a trigger
 * refuses the last content row, after the media rows and the first entries
 * were already written in the same transaction.
 */
describe.each(["sqlite", "postgres"] as const)("an apply whose commit fails on %s", (kind) => {
  const available = kind === "sqlite" || PgTestDatabase.url() !== undefined;
  if (!available) PgTestDatabase.skipping("SILO_TEST_PG_URL is not set");

  test.skipIf(!available)("writes nothing, keeps no file, and can be applied again", async () => {
    const pair = await TransferPair.open({ destination: kind });
    try {
      await pair.seed();
      const answer = await pair.prepare(pair.body());
      const view = await read(answer);
      const remove = await refuse(pair, pair.seeded.picked);
      const before = await pair.snapshot();

      expect((await pair.apply(view.id)).status).toBe(500);
      expect(await pair.snapshot()).toEqual(before);
      expect(await read(pair.call("GET", `${TransferPair.Prepare}/${view.id}`))).toMatchObject({
        state: "prepared",
        last_error: expect.stringContaining("refused by the test"),
      });

      await remove();
      expect((await pair.apply(view.id)).status).toBe(200);
      expect((await pair.destinationService.store.get(Scope.of("acme", "uat"), "posts", pair.seeded.picked)).rev).toBe(1);
    } finally {
      await pair.close();
    }
  });

  /** A trigger refusing the row `id`; answers how to drop it again. */
  async function refuse(pair: TransferPair, id: string): Promise<() => Promise<void>> {
    if (kind === "sqlite") {
      const database = new Database(path.join(pair.tempDir, "destination.db"));
      database.run(`CREATE TRIGGER refuse BEFORE INSERT ON entries WHEN NEW.id = '${id}' BEGIN SELECT RAISE(ABORT, 'refused by the test'); END`);
      return async () => {
        database.run("DROP TRIGGER refuse");
        database.close();
      };
    }
    const schema = (pair.destinationService.store as PgStore).schema;
    await PgTestDatabase.admin(async (sql) => {
      await sql.unsafe(
        `CREATE FUNCTION "${schema}".refuse() RETURNS trigger LANGUAGE plpgsql AS $$
         BEGIN IF NEW.id = '${id}' THEN RAISE EXCEPTION 'refused by the test'; END IF; RETURN NEW; END $$`
      );
      await sql.unsafe(`CREATE TRIGGER refuse BEFORE INSERT ON "${schema}".entries FOR EACH ROW EXECUTE FUNCTION "${schema}".refuse()`);
    });
    return () => PgTestDatabase.admin((sql) => sql.unsafe(`DROP TRIGGER refuse ON "${schema}".entries`)).then(() => {});
  }
});
