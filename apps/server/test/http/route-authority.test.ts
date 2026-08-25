import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { Hono } from "hono";
import { Claims } from "@silo/shared/claims";
import { SqliteStore } from "../../src/adapters/storage/sqlite/sqlite-store";
import { SiloService } from "../../src/core/services/silo-service";
import { KeyUtils } from "../../src/core/keys/key-utils";
import { Scope } from "../../src/core/domain/scope";
import { SiloServer } from "../../src/http/server";
import { Logger } from "../../src/logging/logger";

/**
 * The route-authority audit (D37), as assertions.
 *
 * `ctx` becomes an in-process dispatch of these same routes in phase 3, which
 * turns every route guard into a plugin guard: a route that asks for less than
 * it does is, at that point, a way for a granted plugin to do more than it was
 * granted. This file pins both halves of what the audit found — the gaps that
 * were closed, and the properties that were already right and must stay right,
 * since those are the ones a refactor can quietly break.
 */
describe("route authority (D37)", () => {
  let tempDir: string;
  let store: SqliteStore;
  let service: SiloService;
  let app: Hono;
  let rootKey: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-route-authority-"));
    store = await SqliteStore.open(path.join(tempDir, "silo.db"));
    service = new SiloService(store, { mediaDir: path.join(tempDir, "media") });
    rootKey = await service.keys.bootstrap();
    await service.collections.putSchema(Scope.Default, "posts", {
      type: "object",
      "x-silo-auth": true,
    });
    app = new SiloServer(service, {
      version: "test",
      authDisabled: false,
      logger: Logger.silent(),
    }).build();
  });

  afterEach(async () => {
    await store.close();
  });

  const mint = async (claims: string[]) => (await service.keys.create("probe", claims)).secret;
  const auth = (key: string) => ({ Authorization: `Bearer ${key}` });
  const json = (key: string) => ({ ...auth(key), "Content-Type": "application/json" });

  // ---- Finding 1: force is a second operation, not a modifier ----

  describe("a forced delete asks for the authority to destroy what it destroys", () => {
    test("a collection delete with force needs entries:delete as well", async () => {
      await service.entries.create(Scope.Default, "posts", { n: 1 });
      const key = await mint([
        Claims.collection("default", "prod", "posts", Claims.CollectionDelete),
      ]);

      const refused = await app.request(
        "/api/projects/default/environments/prod/collections/posts/schema?force=true",
        { method: "DELETE", headers: auth(key) }
      );
      expect(refused.status).toBe(403);
      expect(((await refused.json()) as any).error.message).toContain("entries:delete");

      // The entries are still there: the refusal happened before the erase, not
      // after a partial one.
      const survived = await service.entries.list(Scope.Default, "posts", {});
      expect(survived.total).toBe(1);
    });

    test("an unforced collection delete still needs only collection:delete", async () => {
      await service.collections.putSchema(Scope.Default, "empty", { type: "object" });
      const key = await mint([
        Claims.collection("default", "prod", "empty", Claims.CollectionDelete),
      ]);
      const res = await app.request(
        "/api/projects/default/environments/prod/collections/empty/schema",
        { method: "DELETE", headers: auth(key) }
      );
      expect(res.status).toBe(204);
    });

    test("holding both permissions still forces", async () => {
      await service.entries.create(Scope.Default, "posts", { n: 1 });
      const key = await mint([
        Claims.collection("default", "prod", "posts", Claims.CollectionDelete),
        Claims.collection("default", "prod", "posts", Claims.CollectionEntriesDelete),
      ]);
      const res = await app.request(
        "/api/projects/default/environments/prod/collections/posts/schema?force=true",
        { method: "DELETE", headers: auth(key) }
      );
      expect(res.status).toBe(204);
    });

    test("a project delete with force needs entries:delete across the project", async () => {
      await service.entries.create(Scope.Default, "posts", { n: 1 });
      const key = await mint([Claims.collection("default", "*", "*", Claims.CollectionDelete)]);

      const refused = await app.request("/api/projects/default?force=true", {
        method: "DELETE",
        headers: auth(key),
      });
      expect(refused.status).toBe(403);
      expect(await service.scopes.listProjects()).toContain("default");

      const wider = await mint([
        Claims.collection("default", "*", "*", Claims.CollectionDelete),
        Claims.collection("default", "*", "*", Claims.CollectionEntriesDelete),
      ]);
      const allowed = await app.request("/api/projects/default?force=true", {
        method: "DELETE",
        headers: auth(wider),
      });
      expect(allowed.status).toBe(204);
    });

    test("an environment delete with force needs entries:delete across the scope", async () => {
      await service.entries.create(Scope.Default, "posts", { n: 1 });
      const key = await mint([Claims.collection("default", "prod", "*", Claims.CollectionDelete)]);

      const refused = await app.request("/api/projects/default/environments/prod?force=true", {
        method: "DELETE",
        headers: auth(key),
      });
      expect(refused.status).toBe(403);

      const wider = await mint([
        Claims.collection("default", "prod", "*", Claims.CollectionDelete),
        Claims.collection("default", "prod", "*", Claims.CollectionEntriesDelete),
      ]);
      const allowed = await app.request("/api/projects/default/environments/prod?force=true", {
        method: "DELETE",
        headers: auth(wider),
      });
      expect(allowed.status).toBe(204);
    });
  });

  // ---- Finding 2: revoking is bounded the way minting is ----

  describe("revoking a key is bounded by the authority to mint one", () => {
    test("a narrow key holding keys:revoke cannot revoke root", async () => {
      const root = (await service.keys.list()).find((e) => (e.data as any).label === "root")!;
      const key = await mint([Claims.KeysRevoke]);

      const res = await app.request(`/api/keys/${root.id}`, {
        method: "DELETE",
        headers: auth(key),
      });
      expect(res.status).toBe(403);

      // The instance is still reachable — which is the whole point. Before D37
      // this sequence locked the operator out with the narrowest key that
      // existed.
      const check = await app.request("/api/keys", { headers: auth(rootKey) });
      expect(check.status).toBe(200);
    });

    test("root revokes anything", async () => {
      const key = await mint([Claims.KeysRevoke]);
      const target = (await service.keys.list()).find((e) => (e.data as any).label === "probe")!;
      const res = await app.request(`/api/keys/${target.id}`, {
        method: "DELETE",
        headers: auth(rootKey),
      });
      expect(res.status).toBe(204);
      expect(key).toBeTruthy();
    });

    test("a key revokes an equal or narrower one", async () => {
      const wide = await mint([
        Claims.KeysRevoke,
        Claims.collection("acme", "*", "*", Claims.CollectionEntriesRead),
      ]);
      await service.keys.create("narrow", [
        Claims.collection("acme", "prod", "posts", Claims.CollectionEntriesRead),
      ]);
      const narrow = (await service.keys.list()).find((e) => (e.data as any).label === "narrow")!;

      const res = await app.request(`/api/keys/${narrow.id}`, {
        method: "DELETE",
        headers: auth(wide),
      });
      expect(res.status).toBe(204);
    });

    test("a key revokes itself", async () => {
      const secret = await mint([Claims.KeysRevoke]);
      const self = (await service.keys.list()).find((e) => (e.data as any).label === "probe")!;
      const res = await app.request(`/api/keys/${self.id}`, {
        method: "DELETE",
        headers: auth(secret),
      });
      expect(res.status).toBe(204);
    });

    /**
     * The bound reads the target's claims as stored rather than normalizing
     * them, so a hand-edited record stays removable by the key that can remove
     * anything. Normalizing would throw on the way in and turn the one
     * operation that cleans such a record up into a 500 — which is the
     * "simplification" this test exists to fail.
     */
    test("root still revokes a key whose stored claims do not parse", async () => {
      const { entry } = await service.keys.create("corrupt", []);
      (entry.data as any).claims = ["collections:not-a-real-claim"];
      await store.put(entry, { usages: [], search: null });

      const res = await app.request(`/api/keys/${entry.id}`, {
        method: "DELETE",
        headers: auth(rootKey),
      });
      expect(res.status).toBe(204);
    });

    test("a narrow key cannot revoke one whose claims do not parse", async () => {
      const { entry } = await service.keys.create("corrupt", []);
      (entry.data as any).claims = ["collections:not-a-real-claim"];
      await store.put(entry, { usages: [], search: null });

      const key = await mint([Claims.KeysRevoke]);
      const res = await app.request(`/api/keys/${entry.id}`, {
        method: "DELETE",
        headers: auth(key),
      });
      expect(res.status).toBe(403);
    });

    test("a managed key is still refused before the delegation check is reached", async () => {
      await service.keys.create("plugin:acme", [], { kind: "plugin", name: "acme" });
      const managed = (await service.keys.list()).find((e) =>
        KeyUtils.isManaged(e.data as any)
      )!;
      const res = await app.request(`/api/keys/${managed.id}`, {
        method: "DELETE",
        headers: auth(rootKey),
      });
      expect(res.status).toBe(400);
      expect(((await res.json()) as any).error.message).toContain("silo plugin revoke acme");
    });
  });

  // ---- Verified-good properties the audit relied on ----

  describe("properties phase 3 depends on", () => {
    /**
     * The reason `ctx` can be `app.fetch` at all. Every hook dispatch site in
     * `EntryService` sits **outside** `withWriteLock`, so a hook that writes
     * through the HTTP surface acquires a free lock rather than waiting on the
     * one its own caller holds. `AsyncMutex` is not reentrant, so if a dispatch
     * ever moves inside the lock this deadlocks — which is D33's failure
     * exactly, and is why it is asserted rather than assumed.
     */
    test("a hook can re-enter the app through app.fetch without deadlocking", async () => {
      await service.collections.putSchema(Scope.Default, "mirrors", {
        type: "object",
        "x-silo-auth": true,
      });
      let mirrored = 0;
      (service as any).context.useHooks({
        beforeValidate: async (event: any) => event.data,
        beforeWrite: async () => {},
        afterWrite: async (event: any) => {
          if (event.collection !== "posts") return;
          const res = await app.request(
            "/api/projects/default/environments/prod/collections/mirrors",
            { method: "POST", headers: json(rootKey), body: JSON.stringify({ mirror: true }) }
          );
          if (res.status === 201) mirrored++;
        },
        beforeDelete: async () => {},
        afterDelete: async () => {},
      });

      const started = Date.now();
      const res = await app.request("/api/projects/default/environments/prod/collections/posts", {
        method: "POST",
        headers: json(rootKey),
        body: JSON.stringify({ t: "hello" }),
      });

      expect(res.status).toBe(201);
      expect(mirrored).toBe(1);
      // A deadlock here would not fail an assertion, it would hang — so the
      // clock is the assertion, the way D33's regression test measures rather
      // than counts.
      expect(Date.now() - started).toBeLessThan(2000);
    });

    /** The system scope is unaddressable over HTTP because `Scope.of` refuses a
     *  `_`-prefixed id, which is what keeps `_keys` and `_plugins` out of reach
     *  of every collection claim including `*`. */
    test("no collection claim reaches the system scope", async () => {
      for (const url of [
        "/api/projects/_system/environments/_system/collections/_keys",
        "/api/projects/default/environments/prod/collections/_keys",
      ]) {
        const res = await app.request(url, { headers: auth(rootKey) });
        expect(res.status).toBeGreaterThanOrEqual(400);
      }
    });
  });
});
