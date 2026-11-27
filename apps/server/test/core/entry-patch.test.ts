import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { MediaRef } from "@silo/shared/media-ref";
import { ValidationError } from "@silo/shared/validation-error";
import { FsStore } from "../../src/adapters/storage/fs/fs-store";
import { PgStore } from "../../src/adapters/storage/postgres/pg-store";
import { SqliteStore } from "../../src/adapters/storage/sqlite/sqlite-store";
import { Scope } from "../../src/core/domain/scope";
import { ConflictError } from "../../src/core/errors/conflict-error";
import { NotFoundError } from "../../src/core/errors/not-found-error";
import type { Hooks } from "../../src/core/hooks/hooks";
import { NoOpHooks } from "../../src/core/hooks/no-op-hooks";
import type { Storage } from "../../src/core/ports/storage";
import { SiloService } from "../../src/core/services/silo-service";
import { PgTestDatabase } from "../adapters/support/pg-test-database";

type StoreDriver = "sqlite" | "fs" | "postgres";

const postgres = PgTestDatabase.url() !== undefined;
if (!postgres) PgTestDatabase.skipping("SILO_TEST_PG_URL is not set");
const drivers: readonly StoreDriver[] = postgres
  ? ["sqlite", "fs", "postgres"]
  : ["sqlite", "fs"];

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
        nested: {
          type: "object",
          properties: {
            note: { type: "string" },
            kept: { type: "boolean" },
          },
        },
      },
    },
  },
  "x-silo-search": {
    label: ["$.data.title"],
  },
};

for (const driver of drivers) {
  describe(`EntryService.patch (${driver})`, () => {
    let tempDir: string;
    let store: Storage;
    let service: SiloService;

    beforeEach(async () => {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `silo-entry-patch-core-${driver}-`));
      if (driver === "sqlite") {
        const sqlite = await SqliteStore.open(path.join(tempDir, "test.db"), {
          enabled: true,
          tokenizer: "unicode61 remove_diacritics 2",
        });
        store = sqlite;
        service = new SiloService(sqlite, {
          mediaDir: path.join(tempDir, "media"),
          searcher: sqlite.createSearcher() ?? undefined,
        });
      } else if (driver === "fs") {
        store = await FsStore.open(path.join(tempDir, "data"));
        service = new SiloService(store, { mediaDir: path.join(tempDir, "media") });
      } else {
        const pgStore = await PgStore.open({
          url: PgTestDatabase.url()!,
          schema: PgTestDatabase.freshSchema(),
        });
        store = pgStore;
        service = new SiloService(pgStore, {
          mediaDir: path.join(tempDir, "media"),
          searcher: pgStore.createSearcher() ?? undefined,
        });
      }
      await service.scopes.initDefaults(Scope.Default.project, Scope.Default.env);
      await service.collections.putSchema(Scope.Default, "posts", PostSchema);
    });

    afterEach(async () => {
      await store.close();
      if (store instanceof PgStore) await PgTestDatabase.drop(store.schema);
      await fs.rm(tempDir, { recursive: true, force: true });
    });

    test("merges partial fields, nested objects, null deletions, and whole arrays", async () => {
      const created = await service.entries.create(Scope.Default, "posts", {
        title: "Hello",
        subtitle: "Draft subtitle",
        status: "draft",
        tags: ["alpha", "beta"],
        meta: {
          author: "Ada",
          year: 2025,
          nested: { note: "temp", kept: true },
        },
      });

      const patched = await service.entries.patch(
        Scope.Default,
        "posts",
        created.id,
        {
          status: "published",
          subtitle: null,
          tags: ["release"],
          meta: {
            year: 2026,
            nested: { note: null },
          },
        },
        created.rev,
      );

      expect(patched.id).toBe(created.id);
      expect(patched.rev).toBe(2);
      expect(patched.created_at.toISOString()).toBe(created.created_at.toISOString());
      expect(patched.updated_at.getTime()).toBeGreaterThanOrEqual(created.updated_at.getTime());
      expect(patched.data).toEqual({
        title: "Hello",
        status: "published",
        tags: ["release"],
        meta: {
          author: "Ada",
          year: 2026,
          nested: { kept: true },
        },
      });

      const reloaded = await service.entries.get(Scope.Default, "posts", created.id);
      expect(reloaded.rev).toBe(2);
      expect(reloaded.data).toEqual(patched.data);
    });

    test("preserves untouched {{NAME}} templates and valid media references", async () => {
      await service.variables.declare(Scope.Default, "CDN_URL", "", "https://cdn.example.com");
      const asset = await service.media.save("hero.png", new TextEncoder().encode("png-bytes"));

      const created = await service.entries.create(Scope.Default, "posts", {
        title: "{{CDN_URL}}/title",
        status: "draft",
        cover: MediaRef.url(asset.id),
      });

      const patched = await service.entries.patch(
        Scope.Default,
        "posts",
        created.id,
        { status: "published" },
        created.rev,
      );

      expect(patched.data.title).toBe("{{CDN_URL}}/title");
      expect(patched.data.cover).toBe(MediaRef.url(asset.id));
      expect((await service.media.get(asset.id)).usage_count).toBe(1);

      // Canonicalizes a media URL supplied inside the patch, and clearing an
      // optional media field drops its usage count.
      const replacedAsset = await service.media.save("next.png", new TextEncoder().encode("next"));
      const reLinked = await service.entries.patch(
        Scope.Default,
        "posts",
        created.id,
        { cover: `http://cdn.test/media/${replacedAsset.id}` },
        patched.rev,
      );
      expect(reLinked.data.cover).toBe(MediaRef.url(replacedAsset.id));
      expect((await service.media.get(asset.id)).usage_count).toBe(0);
      expect((await service.media.get(replacedAsset.id)).usage_count).toBe(1);

      const cleared = await service.entries.patch(
        Scope.Default,
        "posts",
        created.id,
        { cover: null },
        reLinked.rev,
      );
      expect(cleared.data.cover).toBeUndefined();
      expect((await service.media.get(replacedAsset.id)).usage_count).toBe(0);
    });

    test("rejects an untouched dangling media ref until the patch replaces or clears it", async () => {
      const stale = await service.media.save("stale.png", new TextEncoder().encode("stale"));
      const fresh = await service.media.save("fresh.png", new TextEncoder().encode("fresh"));
      const entry = await service.entries.create(Scope.Default, "posts", {
        title: "Has media",
        status: "draft",
        cover: MediaRef.url(stale.id),
      });

      await service.media.delete(stale.id, { force: true, permanent: true });

      await expect(
        service.entries.patch(Scope.Default, "posts", entry.id, { status: "published" }, entry.rev),
      ).rejects.toThrow(ValidationError);

      // Replacing the dangling reference recovers cleanly.
      const replaced = await service.entries.patch(
        Scope.Default,
        "posts",
        entry.id,
        { cover: MediaRef.url(fresh.id) },
        entry.rev,
      );
      expect(replaced.data.cover).toBe(MediaRef.url(fresh.id));

      // Force-delete the replacement too, then clear the optional field via null.
      await service.media.delete(fresh.id, { force: true, permanent: true });
      const cleared = await service.entries.patch(
        Scope.Default,
        "posts",
        entry.id,
        { cover: null },
        replaced.rev,
      );
      expect(cleared.data.cover).toBeUndefined();
      expect(cleared.rev).toBe(3);
    });

    test("rejects non-plain-object patches and reserved fields upfront", async () => {
      const entry = await service.entries.create(Scope.Default, "posts", { title: "Valid" });

      for (const badPatch of [[], ["a"], null, "text", 42, true, new Date()]) {
        await expect(
          service.entries.patch(Scope.Default, "posts", entry.id, badPatch, entry.rev),
        ).rejects.toThrow(ValidationError);
      }

      for (const reserved of ["id", "rev", "seq", "created_at", "updated_at"]) {
        await expect(
          service.entries.patch(
            Scope.Default,
            "posts",
            entry.id,
            { [reserved]: "spoof" },
            entry.rev,
          ),
        ).rejects.toThrow(ValidationError);

        await expect(
          service.entries.patch(
            Scope.Default,
            "posts",
            entry.id,
            { [reserved]: null },
            entry.rev,
          ),
        ).rejects.toThrow(ValidationError);
      }

      // Nested properties named `id` do not collide with the envelope.
      await service.collections.putSchema(Scope.Default, "nested_ids", { type: "object" });
      const nested = await service.entries.create(Scope.Default, "nested_ids", {
        title: "One",
        author: { id: "a1", name: "Ada" },
      });
      const updated = await service.entries.patch(
        Scope.Default,
        "nested_ids",
        nested.id,
        { author: { id: "a2" } },
        nested.rev,
      );
      expect(updated.data.author).toEqual({ id: "a2", name: "Ada" });
    });

    test("refuses system collections and missing entries", async () => {
      await expect(
        service.entries.patch(Scope.Default, "_keys", "01ABC", { label: "x" }, 1),
      ).rejects.toThrow(NotFoundError);
      await expect(
        service.entries.patch(Scope.Default, "posts", "01MISSING", { title: "x" }, 1),
      ).rejects.toThrow(NotFoundError);
    });

    test("checks rev before hooks and re-checks authoritatively under the write lock", async () => {
      const entry = await service.entries.create(Scope.Default, "posts", {
        title: "Original",
        status: "draft",
      });

      const seen: Array<{ hook: string; op: string; rev?: number; data: unknown }> = [];
      let simulateRace = false;

      const useTestHooks = (overrides: Partial<Hooks>): void => {
        (service as unknown as { context: { useHooks: (hooks: Hooks) => void } }).context.useHooks(
          Object.assign(new NoOpHooks(), overrides),
        );
      };

      useTestHooks({
        beforeValidate: async (event) => {
          seen.push({ hook: "beforeValidate", op: event.op, data: structuredClone(event.data) });
          return { ...(event.data as Record<string, unknown>), status: "hooked" };
        },
        beforeWrite: async (event) => {
          seen.push({ hook: "beforeWrite", op: event.op, rev: event.rev, data: event.data });
          if (simulateRace) {
            const latest = await store.get(Scope.Default, "posts", entry.id);
            await store.put(
              { ...latest, rev: latest.rev + 1, data: { ...latest.data, title: "Concurrent" } },
              { usages: [], search: null },
            );
          }
        },
        afterWrite: async (event) => {
          seen.push({ hook: "afterWrite", op: event.op, rev: event.rev, data: event.data });
        },
      });

      // Stale rev must reject BEFORE any hook fires.
      await expect(
        service.entries.patch(Scope.Default, "posts", entry.id, { title: "Stale" }, 99),
      ).rejects.toThrow(ConflictError);
      expect(seen).toEqual([]);

      // Normal patch fires update hooks with merged data and incremented preview rev.
      const patched = await service.entries.patch(
        Scope.Default,
        "posts",
        entry.id,
        { title: "Patched" },
        entry.rev,
      );
      expect(patched.data).toEqual({ title: "Patched", status: "hooked" });
      expect(seen.map((item) => `${item.hook}:${item.op}`)).toEqual([
        "beforeValidate:update",
        "beforeWrite:update",
        "afterWrite:update",
      ]);
      expect(seen[1]?.rev).toBe(2);

      // Concurrent write between preview read and withWriteLock is caught by the
      // authoritative lock-protected assertRev.
      simulateRace = true;
      await expect(
        service.entries.patch(Scope.Default, "posts", entry.id, { title: "Lost update" }, patched.rev),
      ).rejects.toThrow(ConflictError);

      const survived = await service.entries.get(Scope.Default, "posts", entry.id);
      expect(survived.rev).toBe(3);
      expect(survived.data.title).toBe("Concurrent");
    });

    test("rejects same-revision seq advance between merge and write lock", async () => {
      const entry = await service.entries.create(Scope.Default, "posts", {
        title: "Original",
        subtitle: "Initial",
        status: "draft",
      });

      (service as unknown as { context: { useHooks: (hooks: Hooks) => void } }).context.useHooks(
        Object.assign(new NoOpHooks(), {
          beforeWrite: async () => {
            // Simulate an import that keeps `rev` equal while writing newer data
            // and advancing `seq`.
            const latest = await store.get(Scope.Default, "posts", entry.id);
            await store.put(
              { ...latest, data: { ...latest.data, subtitle: "Imported overwrite" } },
              { usages: [], search: null },
            );
          },
        }),
      );

      let conflictMessage = "";
      try {
        await service.entries.patch(Scope.Default, "posts", entry.id, { status: "published" }, entry.rev);
      } catch (caught) {
        expect(caught).toBeInstanceOf(ConflictError);
        conflictMessage = (caught as ConflictError).message;
      }
      expect(conflictMessage).toContain(`entry "${entry.id}" was modified concurrently`);
      expect(conflictMessage).not.toContain("seq");

      const survived = await service.entries.get(Scope.Default, "posts", entry.id);
      expect(survived.rev).toBe(entry.rev);
      expect(survived.seq).toBeGreaterThan(entry.seq);
      expect(survived.data.subtitle).toBe("Imported overwrite");
      expect(survived.data.status).toBe("draft");
    });

    test("re-validates under write lock when schema changes or collection is deleted during beforeWrite", async () => {
      const entry = await service.entries.create(Scope.Default, "posts", {
        title: "Original",
        status: "draft",
      });

      let mode: "narrow-schema" | "delete-collection" = "narrow-schema";
      (service as unknown as { context: { useHooks: (hooks: Hooks) => void } }).context.useHooks(
        Object.assign(new NoOpHooks(), {
          beforeWrite: async () => {
            if (mode === "narrow-schema") {
              await service.collections.putSchema(Scope.Default, "posts", {
                ...PostSchema,
                properties: {
                  ...PostSchema.properties,
                  status: { type: "string", enum: ["draft"] },
                },
              });
            } else {
              await service.collections.delete(Scope.Default, "posts", true);
            }
          },
        }),
      );

      await expect(
        service.entries.patch(Scope.Default, "posts", entry.id, { status: "published" }, entry.rev),
      ).rejects.toThrow(ValidationError);

      const survived = await service.entries.get(Scope.Default, "posts", entry.id);
      expect(survived.rev).toBe(entry.rev);
      expect(survived.data.status).toBe("draft");

      mode = "delete-collection";
      await expect(
        service.entries.patch(Scope.Default, "posts", entry.id, { subtitle: "Added" }, entry.rev),
      ).rejects.toThrow(NotFoundError);
    });

    test("guards prepare() and write lock against A -> B -> A schema oscillation on patch and create", async () => {
      const strictSchema = {
        ...PostSchema,
        properties: {
          ...PostSchema.properties,
          status: { type: "string", enum: ["draft"] },
        },
      };
      await service.collections.putSchema(Scope.Default, "posts", strictSchema);
      const entry = await service.entries.create(Scope.Default, "posts", {
        title: "Original",
        status: "draft",
      });

      const originalFindCollection = store.findCollection.bind(store);
      let flipToLooseOnce = false;
      (service as unknown as { context: { useHooks: (hooks: Hooks) => void } }).context.useHooks(
        Object.assign(new NoOpHooks(), {
          beforeWrite: async () => {
            // Oscillate back to strictSchema (B -> A) before the write lock runs.
            await service.collections.putSchema(Scope.Default, "posts", strictSchema);
          },
        }),
      );

      store.findCollection = async (targetScope, name) => {
        const record = await originalFindCollection(targetScope, name);
        if (flipToLooseOnce) {
          flipToLooseOnce = false;
          // Switch A -> B (loose) right after prepare() captures strictSchema A.
          await service.collections.putSchema(Scope.Default, "posts", PostSchema);
        }
        return record;
      };

      try {
        flipToLooseOnce = true;
        await expect(
          service.entries.patch(Scope.Default, "posts", entry.id, { status: "published" }, entry.rev),
        ).rejects.toThrow(ValidationError);

        const unchanged = await service.entries.get(Scope.Default, "posts", entry.id);
        expect(unchanged.rev).toBe(entry.rev);
        expect(unchanged.data.status).toBe("draft");

        // EntryService.create uses the exact same generation-bound prepare()/write-lock guard.
        flipToLooseOnce = true;
        await expect(
          service.entries.create(Scope.Default, "posts", { title: "New", status: "published" }),
        ).rejects.toThrow(ValidationError);

        // Even a full A -> B -> A cycle strictly inside beforeWrite bumps generation
        // so write lock still re-validates instead of trusting equal schema JSON.
        const registry = (
          service as unknown as {
            context: {
              schemaRegistry: {
                validateEntry: (s: Scope, c: string, d: unknown) => Promise<void>;
              };
            };
          }
        ).context.schemaRegistry;
        const originalValidateEntry = registry.validateEntry.bind(registry);
        let validateCalls = 0;
        registry.validateEntry = async (s, c, d) => {
          validateCalls += 1;
          return originalValidateEntry(s, c, d);
        };
        (service as unknown as { context: { useHooks: (hooks: Hooks) => void } }).context.useHooks(
          Object.assign(new NoOpHooks(), {
            beforeWrite: async () => {
              await service.collections.putSchema(Scope.Default, "posts", PostSchema);
              await service.collections.putSchema(Scope.Default, "posts", strictSchema);
            },
          }),
        );

        try {
          await service.entries.patch(Scope.Default, "posts", entry.id, { subtitle: "Allowed" }, entry.rev);
          expect(validateCalls).toBe(2);
        } finally {
          registry.validateEntry = originalValidateEntry;
        }
      } finally {
        store.findCollection = originalFindCollection;
      }
    });

    test("isolates obsolete compiling validators from newer generations across invalidate()", async () => {
      const strictSchema = {
        ...PostSchema,
        properties: {
          ...PostSchema.properties,
          status: { type: "string", enum: ["draft"] },
        },
      };
      await service.collections.putSchema(Scope.Default, "posts", strictSchema);

      const originalListCollections = store.listCollections.bind(store);
      let nextAction: "loose" | "strict" | null = null;
      store.listCollections = async (targetScope) => {
        const collections = await originalListCollections(targetScope);
        if (nextAction !== null) {
          const action = nextAction;
          nextAction = null;
          // Run `putSchema` after `collections` captured the old schema, racing
          // `SchemaValidator.compileFrom` against `SchemaRegistry.invalidate()`.
          await service.collections.putSchema(
            Scope.Default,
            "posts",
            action === "loose" ? PostSchema : strictSchema,
          );
        }
        return collections;
      };

      try {
        // Obsolete failing validator (`strictSchema`) throws mid-prepare after
        // `putSchema(PostSchema)` invalidated: prepare() retries cleanly and
        // does not poison the new generation's cache with `strictSchema`.
        nextAction = "loose";
        const entry = await service.entries.create(Scope.Default, "posts", {
          title: "Published on retry",
          status: "published",
        });
        expect(nextAction).toBeNull();
        expect(entry.data.status).toBe("published");

        // Next write still observes the loose schema from the fresh cache.
        const patched = await service.entries.patch(
          Scope.Default,
          "posts",
          entry.id,
          { status: "draft", subtitle: "Still valid" },
          entry.rev,
        );
        expect(patched.data.subtitle).toBe("Still valid");

        // Obsolete passing validator (`PostSchema`) finishes compiling after
        // `putSchema(strictSchema)` invalidated: its stale validator must stay
        // confined to the dead map and must not admit `"published"` afterwards.
        // Calling `putSchema(PostSchema)` clears the compiled cache so the next
        // write enters `listCollections` and exercises the compile-vs-invalidate race.
        await service.collections.putSchema(Scope.Default, "posts", PostSchema);
        nextAction = "strict";
        await service.entries.patch(
          Scope.Default,
          "posts",
          entry.id,
          { subtitle: "Allowed draft" },
          patched.rev,
        );
        expect(nextAction).toBeNull();
        await expect(
          service.entries.create(Scope.Default, "posts", {
            title: "Should reject",
            status: "published",
          }),
        ).rejects.toThrow(ValidationError);
      } finally {
        store.listCollections = originalListCollections;
      }
    });

    test("overlapping writers retry after one schema edit without escalating generation", async () => {
      const registry = (
        service as unknown as {
          context: {
            schemaRegistry: {
              currentGeneration: () => number;
              validateEntry: (s: Scope, c: string, d: unknown) => Promise<void>;
            };
          };
        }
      ).context.schemaRegistry;

      const updatedSchema = {
        ...PostSchema,
        properties: {
          ...PostSchema.properties,
          extra: { type: "string" },
        },
      };

      const originalFindCollection = store.findCollection.bind(store);
      let gateActive = true;
      let snapped = 0;
      let releaseBoth!: () => void;
      const waitBoth = new Promise<void>((resolve) => {
        releaseBoth = resolve;
      });

      store.findCollection = async (targetScope, name) => {
        const record = await originalFindCollection(targetScope, name);
        if (gateActive) {
          snapped += 1;
          if (snapped < 2) {
            await waitBoth;
          } else {
            gateActive = false;
            // One concurrent schema edit bumps generation exactly once while
            // both writers are inside prepare().
            await service.collections.putSchema(Scope.Default, "posts", updatedSchema);
            releaseBoth();
          }
        }
        return record;
      };

      const generationBefore = registry.currentGeneration();
      try {
        const [first, second] = await Promise.all([
          service.entries.create(Scope.Default, "posts", { title: "Writer 1", extra: "one" }),
          service.entries.create(Scope.Default, "posts", { title: "Writer 2", extra: "two" }),
        ]);
        expect(first.data.extra).toBe("one");
        expect(second.data.extra).toBe("two");
        expect(registry.currentGeneration()).toBe(generationBefore + 1);
      } finally {
        store.findCollection = originalFindCollection;
      }

      // Also verify an A -> B -> A oscillation strictly inside beforeWrite
      // re-validates under write lock without advancing `generation` again.
      const generationAfterBarrier = registry.currentGeneration();
      const target = await service.entries.create(Scope.Default, "posts", { title: "Oscillate" });
      const originalValidateEntry = registry.validateEntry.bind(registry);
      let validateCalls = 0;
      registry.validateEntry = async (s, c, d) => {
        validateCalls += 1;
        return originalValidateEntry(s, c, d);
      };
      (service as unknown as { context: { useHooks: (hooks: Hooks) => void } }).context.useHooks(
        Object.assign(new NoOpHooks(), {
          beforeWrite: async () => {
            await service.collections.putSchema(Scope.Default, "posts", PostSchema);
            await service.collections.putSchema(Scope.Default, "posts", updatedSchema);
          },
        }),
      );

      try {
        await service.entries.patch(Scope.Default, "posts", target.id, { subtitle: "Ok" }, target.rev);
        expect(validateCalls).toBe(2);
        expect(registry.currentGeneration()).toBe(generationAfterBarrier + 2);
      } finally {
        registry.validateEntry = originalValidateEntry;
      }
    });

    test("updates the derived search index on patch", async () => {
      const entry = await service.entries.create(Scope.Default, "posts", {
        title: "BeforeTerm",
        status: "draft",
      });

      await service.entries.patch(
        Scope.Default,
        "posts",
        entry.id,
        { title: "AfterTerm" },
        entry.rev,
      );

      const access = await service.search.access(["*"], {
        project: Scope.Default.project,
        env: Scope.Default.env,
        collection: "posts",
      });
      const oldHits = await service.search.run({ q: "BeforeTerm", limit: 10, offset: 0 }, access);
      const newHits = await service.search.run({ q: "AfterTerm", limit: 10, offset: 0 }, access);
      expect(oldHits.total).toBe(0);
      expect(newHits.total).toBe(1);
      expect(newHits.items[0]?.entry.id).toBe(entry.id);
    });
  });
}
