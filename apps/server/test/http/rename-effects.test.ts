import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { SqliteStore } from "../../src/adapters/storage/sqlite/sqlite-store";
import { FsStore } from "../../src/adapters/storage/fs/fs-store";
import { SiloService } from "../../src/core/services/silo-service";
import { Scope } from "../../src/core/domain/scope";
import { AuditUtils } from "../../src/core/audit/audit-utils";

/**
 * What a rename does to the things that are *derived* from a scope's name, and
 * what a restart does after one (D51).
 *
 * The routes and the claim cascade are covered in `rename-api.test.ts`; this is
 * about the two places a stale name would not raise an error, only a wrong
 * answer — the search index, and `initDefaults`.
 */
describe("what a rename affects", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-rename-effects-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  test("the native search index follows a renamed scope", async () => {
    const store = await SqliteStore.open(path.join(tempDir, "silo.db"));
    const searcher = store.createSearcher("unicode61 remove_diacritics 2");
    const service = new SiloService(store, {
      mediaDir: path.join(tempDir, "media"),
      searcher: searcher ?? undefined,
    });
    const actor = AuditUtils.cli();

    try {
      const before = Scope.of("acme", "dev");
      await service.collections.putSchema(before, "posts", {
        type: "object",
        "x-silo-search": { label: ["$.data.title"] },
      });
      await service.entries.create(before, "posts", { title: "findable" });

      const everything = { targets: [{ project: "*", env: "*", collection: "*" }] };
      const found = async (project: string) =>
        (await searcher!.search({ q: "findable", limit: 10, offset: 0 }, everything)).items.map(
          (hit) => hit.project,
        );

      expect(await found("acme")).toEqual(["acme"]);

      await service.renames.renameProject("acme", "globex", actor);

      // The index rows never moved — they are keyed by record id — so what
      // changes is only the name the join reports.
      expect(await found("globex")).toEqual(["globex"]);
      expect(
        (
          await searcher!.search(
            { q: "findable", limit: 10, offset: 0, project: "acme", env: "dev" },
            everything,
          )
        ).total,
      ).toBe(0);

      // ...and the integrity check still sees no drift, which is what would
      // catch an index row orphaned by the rename.
      const report = searcher!.check();
      expect(report.orphanDocuments).toBe(0);
      expect(report.missingDocuments).toBe(0);
    } finally {
      await store.close();
    }
  });

  test("a renamed default project is not resurrected at the next start", async () => {
    const dbPath = path.join(tempDir, "silo.db");

    const first = await SqliteStore.open(dbPath);
    const firstService = new SiloService(first, { mediaDir: path.join(tempDir, "media") });
    await firstService.scopes.initDefaults("default", "prod");
    expect((await first.listProjects()).map((record) => record.name)).toEqual(["default"]);
    await firstService.renames.renameProject("default", "main", AuditUtils.cli());
    await first.close();

    // The restart. `initDefaults` used to create the scope whenever it was
    // *missing*, so this is where an empty `default` came back.
    const second = await SqliteStore.open(dbPath);
    const secondService = new SiloService(second, { mediaDir: path.join(tempDir, "media") });
    await secondService.scopes.initDefaults("default", "prod");
    expect((await second.listProjects()).map((record) => record.name)).toEqual(["main"]);
    await second.close();
  });

  test("a deleted sole project is not resurrected either", async () => {
    const dbPath = path.join(tempDir, "silo.db");

    const first = await SqliteStore.open(dbPath);
    const firstService = new SiloService(first, { mediaDir: path.join(tempDir, "media") });
    await firstService.scopes.initDefaults("default", "prod");
    await firstService.scopes.deleteProject("default", true);
    await first.close();

    // "Seed when no projects exist" would have failed this one, which is why
    // the flag is durable rather than derived.
    const second = await SqliteStore.open(dbPath);
    const secondService = new SiloService(second, { mediaDir: path.join(tempDir, "media") });
    await secondService.scopes.initDefaults("default", "prod");
    expect(await second.listProjects()).toEqual([]);
    await second.close();
  });

  test("the fs adapter renames all three end to end, and heals a crashed collection move", async () => {
    const dir = path.join(tempDir, "data");
    const store = await FsStore.open(dir);
    const service = new SiloService(store, { mediaDir: path.join(tempDir, "media") });
    const actor = AuditUtils.cli();

    try {
      const before = Scope.of("acme", "dev");
      await service.collections.putSchema(before, "posts", { type: "object" });
      const entry = await service.entries.create(before, "posts", { title: "x" });

      await service.renames.renameProject("acme", "globex", actor);
      await service.renames.renameEnvironment("globex", "dev", "staging", actor);
      const after = Scope.of("globex", "staging");
      await service.renames.renameCollection(after, "posts", "articles", actor);

      // The directories moved with the names, and the entry file went with them.
      const entryFile = path.join(
        dir,
        "projects",
        "globex",
        "staging",
        "content",
        "articles",
        `${entry.id}.json`,
      );
      const document = JSON.parse(await fs.readFile(entryFile, "utf8"));
      expect(document.data).toEqual({ title: "x" });

      // Every marker carries its record's id, which is what an archive needs to
      // preserve identity.
      for (const marker of [
        path.join(dir, "projects", "globex", ".silo-project"),
        path.join(dir, "projects", "globex", "staging", ".silo-env"),
        path.join(dir, "projects", "globex", "staging", "schemas", ".articles.silo-collection"),
      ]) {
        const parsed = JSON.parse(await fs.readFile(marker, "utf8"));
        expect(typeof parsed.id).toBe("string");
        expect(parsed.id.length).toBeGreaterThan(0);
      }
    } finally {
      await store.close();
    }
  });

  test("a collection move interrupted between its files is finished at the next open", async () => {
    const dir = path.join(tempDir, "data");
    const first = await FsStore.open(dir);
    const scope = Scope.of("acme", "dev");

    try {
      await first.putSchema(scope, "posts", { type: "object" });
    } finally {
      await first.close();
    }

    // Stage the state a crash after the first phase leaves: a destination
    // marker naming where the move came from, and the schema still at the old
    // name. The id in it is what makes this resumable rather than a collision.
    const schemas = path.join(dir, "projects", "acme", "dev", "schemas");
    const original = JSON.parse(
      await fs.readFile(path.join(schemas, ".posts.silo-collection"), "utf8"),
    );
    await fs.writeFile(
      path.join(schemas, ".articles.silo-collection"),
      JSON.stringify({ ...original, moving_from: "posts" }),
      "utf8",
    );

    const second = await FsStore.open(dir);
    try {
      // Opening finished it: one collection, under the new name, with the id it
      // always had.
      const collections = await second.listCollections(scope);
      expect(collections.map((record) => record.name)).toEqual(["articles"]);
      expect(collections[0].id).toBe(original.id);

      const marker = JSON.parse(
        await fs.readFile(path.join(schemas, ".articles.silo-collection"), "utf8"),
      );
      expect(marker.moving_from).toBeUndefined();
      expect(await fs.readdir(schemas)).not.toContain("posts.schema.json");
    } finally {
      await second.close();
    }
  });
});
