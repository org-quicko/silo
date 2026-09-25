import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import type { Hono } from "hono";
import { FsStore } from "../../src/adapters/storage/fs/fs-store";
import { SqliteStore } from "../../src/adapters/storage/sqlite/sqlite-store";
import { Scope } from "../../src/core/domain/scope";
import type { Storage } from "../../src/core/ports/storage";
import { SiloService } from "../../src/core/services/silo-service";
import { Exporter } from "../../src/core/transfer/exporter";
import { SiloServer } from "../../src/http/server";
import { Logger } from "../../src/logging/logger";

/**
 * An entry leaves silo with its fields in schema order, then the fields the
 * schema does not name in codepoint order, whichever store holds it and
 * whatever order it was written in (D93). Both adapters face the same
 * expectations, so a store that answered differently fails here.
 */
describe.each(["sqlite", "fs"] as const)("field order (%s)", (driver) => {
  let tempDir: string;
  let store: Storage;
  let service: SiloService;
  let app: Hono;

  const schema = {
    type: "object",
    properties: {
      title: { type: "string" },
      body: { type: "string" },
      author: { $ref: "#/$defs/person" },
    },
    $defs: { person: { type: "object", properties: { name: {}, email: {} } } },
  };
  // Written in an order the schema does not use, with two undeclared fields.
  const written = { zeta: 1, body: "b", author: { email: "e", name: "n" }, alpha: 0, title: "t" };
  const expected = ["id", "rev", "title", "body", "author", "alpha", "zeta", "created_at", "updated_at"];
  const base = "/api/projects/default/envs/prod/collections/posts";

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-field-order-"));
    store =
      driver === "sqlite"
        ? await SqliteStore.open(path.join(tempDir, "silo.db"))
        : await FsStore.open(path.join(tempDir, "data"));
    service = new SiloService(store, { mediaDir: path.join(tempDir, "media") });
    await service.keys.bootstrap();
    await service.collections.putSchema(Scope.Default, "posts", schema);
    app = new SiloServer(service, { version: "test", authDisabled: false, logger: Logger.silent() }).build();
  });

  afterEach(async () => {
    await store.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const read = async (url: string): Promise<any> => {
    const response = await app.request(url);
    expect(response.status).toBe(200);
    return response.json();
  };

  test("a read, a list and a search hit all answer in schema order", async () => {
    const created = await service.entries.create(Scope.Default, "posts", written);

    const one = await read(`${base}/${created.id}`);
    expect(Object.keys(one)).toEqual(expected);
    expect(Object.keys(one.author)).toEqual(["name", "email"]);

    const list = await read(base);
    expect(Object.keys(list.data[0])).toEqual(expected);

    const search = await read(`${base}/search?q=t`);
    expect(Object.keys(search.data[0].entry)).toEqual(expected);
  });

  test("an export writes the data in the same order", async () => {
    const created = await service.entries.create(Scope.Default, "posts", written);
    const exportDir = path.join(tempDir, "export");
    await Exporter.exportDir(store, exportDir, {});

    const file = path.join(exportDir, "projects/default/prod/content/posts", `${created.id}.json`);
    const archived = JSON.parse(await fs.readFile(file, "utf8"));
    expect(Object.keys(archived.data)).toEqual(["title", "body", "author", "alpha", "zeta"]);
    expect(Object.keys(archived.data.author)).toEqual(["name", "email"]);
  });
});
