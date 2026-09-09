import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { Hono } from "hono";
import { Claims } from "@silo/shared/claims";
import { SqliteStore } from "../../src/adapters/storage/sqlite/sqlite-store";
import { SiloService } from "../../src/core/services/silo-service";
import { SiloServer } from "../../src/http/server";
import { Logger } from "../../src/logging/logger";

/**
 * Reading the media library needs no claim (D58).
 *
 * Every read below is exercised **with no credential at all**, which is the
 * whole assertion: `GET /media/<id>` has served the bytes to anyone since D23,
 * so a claim over the catalog was a lock on the index of an open shelf. What
 * these pin is that the lock is gone from all five reads and from none of the
 * writes — the mistake this decision could turn into is a library anyone can
 * empty, not one anyone can list.
 */
describe("media reads are open (D58)", () => {
  let tempDir: string;
  let store: SqliteStore;
  let service: SiloService;
  let app: Hono;
  let assetId: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-media-open-"));
    store = await SqliteStore.open(path.join(tempDir, "silo.db"));
    service = new SiloService(store, { mediaDir: path.join(tempDir, "media") });
    await service.keys.bootstrap();
    app = new SiloServer(service, {
      version: "test",
      authDisabled: false,
      logger: Logger.silent(),
    }).build();

    await service.media.createFolder("/marketing");
    assetId = (
      await service.media.save("hero.png", new Uint8Array([1, 2, 3]), "image/png", "/marketing")
    ).id;
  });

  afterEach(async () => {
    await store.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const anonymous = (path: string) => app.request(path);

  test("the listing, an asset, its usages, the folders and the extensions all answer", async () => {
    expect((await anonymous("/api/media")).status).toBe(200);
    expect((await anonymous(`/api/media/${assetId}`)).status).toBe(200);
    expect((await anonymous(`/api/media/${assetId}/usages`)).status).toBe(200);
    expect((await anonymous("/api/media/folders")).status).toBe(200);
    expect((await anonymous("/api/media/extensions")).status).toBe(200);
  });

  test("the listing is the real catalog, not an empty one a filter left behind", async () => {
    const body = (await (await anonymous("/api/media")).json()) as { items: { id: string }[] };
    expect(body.items.map((item) => item.id)).toContain(assetId);
  });

  test("the bytes were always open, and still are", async () => {
    const response = await anonymous(`/media/${assetId}`);
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  test("every write still asks for its claim", async () => {
    // A real key that holds no media claim, rather than no key at all: an
    // anonymous write is refused by authentication, which would prove nothing
    // about the claim check underneath it.
    const bystander = (await service.keys.create("bystander", [Claims.KeysRead])).secret;
    const as = (init: RequestInit = {}) => ({
      ...init,
      headers: { ...(init.headers ?? {}), Authorization: `Bearer ${bystander}` },
    });

    const form = new FormData();
    form.append("file", new File([new Uint8Array([9])], "late.png", { type: "image/png" }));
    expect((await app.request("/api/media", as({ method: "POST", body: form }))).status).toBe(403);

    expect(
      (
        await app.request(
          `/api/media/${assetId}`,
          as({
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ filename: "renamed.png" }),
          })
        )
      ).status
    ).toBe(403);

    expect((await app.request(`/api/media/${assetId}`, as({ method: "DELETE" }))).status).toBe(403);

    expect(
      (
        await app.request(
          "/api/media/folders",
          as({
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: "/late" }),
          })
        )
      ).status
    ).toBe(403);
  });

  test("media:read is retired: it cannot be minted, and it is dropped rather than refused", async () => {
    // Credentials outlive releases, so a list carrying it is accepted and loads
    // with the rest of its claims intact — the retired one simply is not there
    // afterwards, and grants nothing.
    const { entry } = await service.keys.create("legacy", ["media:read", Claims.MediaCreate]);
    expect((entry.data as { claims: string[] }).claims).toEqual([Claims.MediaCreate]);
    expect(Claims.isValid("media:read")).toBe(false);
  });
});
