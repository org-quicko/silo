import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { Hono } from "hono";
import { Claims } from "@silo/shared/claims";
import { SqliteStore } from "../../src/adapters/storage/sqlite/sqlite-store";
import { SiloService } from "../../src/core/services/silo-service";
import { AuditUtils } from "../../src/core/audit/audit-utils";
import { SiloServer } from "../../src/http/server";
import { Logger } from "../../src/logging/logger";

/**
 * The trail of authority changes (D38), and the lineage it records.
 *
 * The trail is written by the **services**, not by the routes, which is what
 * makes the offline CLI auditable too — a log that only saw the API would say a
 * key appeared from nowhere, and that is the question it exists to answer.
 */
describe("audit trail (D38)", () => {
  let tempDir: string;
  let store: SqliteStore;
  let service: SiloService;
  let app: Hono;
  let rootKey: string;
  let rootId: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-audit-"));
    store = await SqliteStore.open(path.join(tempDir, "silo.db"));
    service = new SiloService(store, { mediaDir: path.join(tempDir, "media") });
    rootKey = await service.keys.bootstrap();
    rootId = (await service.keys.list()).find((e) => (e.data as any).label === "root")!.id;
    app = new SiloServer(service, {
      version: "test",
      authDisabled: false,
      logger: Logger.silent(),
    }).build();
  });

  afterEach(async () => {
    await store.close();
  });

  const auth = (key: string) => ({ Authorization: `Bearer ${key}` });
  const json = (key: string) => ({ ...auth(key), "Content-Type": "application/json" });
  const mintVia = async (key: string, label: string, claims: string[]) => {
    const res = await app.request("/api/keys", {
      method: "POST",
      headers: json(key),
      body: JSON.stringify({ label, claims }),
    });
    return (await res.json()) as any;
  };

  describe("what it records", () => {
    test("minting through the API names the minter and the claims", async () => {
      const child = await mintVia(rootKey, "child", [Claims.MediaRead]);

      const { items } = await service.audit.list();
      const event = items.find((e) => e.action === "key.create" && e.subject === child.id)!;
      expect(event.actor).toEqual({ kind: "key", id: rootId, label: "root" });
      expect(event.detail.claims).toEqual([Claims.MediaRead]);
      expect(event.detail.parent_id).toBe(rootId);
    });

    test("the offline path is recorded as the CLI, not as a missing actor", async () => {
      await service.keys.create("offline", [Claims.MediaRead], { actor: AuditUtils.cli() });

      const { items } = await service.audit.list();
      expect(items[0].actor).toEqual({ kind: "cli" });
    });

    test("bootstrapping is recorded as the system, since no actor exists yet", async () => {
      const { items } = await service.audit.list();
      const boot = items.find((e) => e.subject === rootId)!;
      expect(boot.actor).toEqual({ kind: "system" });
      expect(boot.detail.claims).toEqual([Claims.Root]);
    });

    test("a grant records what was approved and what was left out", async () => {
      await service.plugins.reconcile("acme", ["collections:*/*/*:entries:read", "media:read"], []);
      await service.plugins.grant("acme", ["media:read"], { actor: AuditUtils.cli() });

      const { items } = await service.audit.list({ subject: "acme" });
      expect(items[0].action).toBe("plugin.grant");
      expect(items[0].detail.granted).toEqual(["media:read"]);
      expect(items[0].detail.not_granted).toEqual(["collections:*/*/*:entries:read"]);
    });

    test("a revocation records what was taken away, since the record no longer says", async () => {
      await service.plugins.reconcile("acme", ["media:read"], []);
      await service.plugins.grant("acme", ["media:read"], { actor: AuditUtils.cli() });
      await service.plugins.revoke("acme", { actor: AuditUtils.cli() });

      const { items } = await service.audit.list({ subject: "acme" });
      expect(items[0].action).toBe("plugin.revoke");
      expect(items[0].detail.withdrawn).toEqual(["media:read"]);
    });

    /**
     * `keys.create` appends before the grant's write is attempted, so a refused
     * write leaves a creation with no matching removal unless the rollback says
     * so too. A trail that lies about a credential is worse than no trail.
     */
    test("every managed key that disappears says why", async () => {
      await service.plugins.reconcile("acme", ["media:read"], []);
      const first = await service.plugins.grant("acme", ["media:read"], {
        actor: AuditUtils.cli(),
      });

      // Re-granting rotates the key: the replaced one is recorded as removed.
      await service.plugins.grant("acme", ["media:read"], { actor: AuditUtils.cli() });
      const replaced = (await service.audit.list({ subject: first.key_id! })).items;
      expect(replaced.map((e) => e.action)).toEqual(["key.revoke", "key.create"]);
      expect(replaced[0].detail.reason).toBe("replaced by a newly granted key");

      // And a refused grant takes back the key it minted on the way out.
      await expect(
        service.plugins.grant("acme", ["media:read"], {
          actor: AuditUtils.cli(),
          expectedRev: 99,
        })
      ).rejects.toThrow(/rev mismatch/);

      const created = (await service.audit.list({ limit: 200 })).items.filter(
        (e) => e.action === "key.create" && e.detail.label === "plugin:acme"
      );
      const removed = (await service.audit.list({ limit: 200 })).items.filter(
        (e) => e.action === "key.revoke" && e.detail.label === "plugin:acme"
      );
      // Three minted, two gone — the live one is the only survivor.
      expect(created).toHaveLength(3);
      expect(removed).toHaveLength(2);
      expect(removed.map((e) => e.detail.reason)).toContain(
        "the grant it was minted for was refused"
      );
    });

    test("reconciling is deliberately not recorded", async () => {
      const before = (await service.audit.list()).total;
      await service.plugins.reconcile("acme", ["media:read"], []);
      await service.plugins.reconcile("acme", ["media:read"], []);
      // One line per plugin per start would bury the decisions the trail holds.
      expect((await service.audit.list()).total).toBe(before);
    });

    test("no secret and no hash reaches the trail", async () => {
      const child = await mintVia(rootKey, "child", [Claims.MediaRead]);
      const serialized = JSON.stringify((await service.audit.list()).items);

      expect(serialized).not.toContain(child.key);
      expect(serialized).not.toContain("hash");
    });
  });

  describe("reading it", () => {
    test("newest first, which is the only order a trail is read in", async () => {
      await mintVia(rootKey, "first", [Claims.MediaRead]);
      await mintVia(rootKey, "second", [Claims.MediaRead]);

      const res = await app.request("/api/audit", { headers: auth(rootKey) });
      const body = (await res.json()) as any;
      expect(body.items[0].detail.label).toBe("second");
      expect(body.items[1].detail.label).toBe("first");
    });

    test("filtering by subject answers the question anyone actually brings", async () => {
      const child = await mintVia(rootKey, "child", [Claims.MediaRead]);
      await mintVia(rootKey, "other", [Claims.MediaRead]);

      const res = await app.request(`/api/audit?subject=${child.id}`, { headers: auth(rootKey) });
      const body = (await res.json()) as any;
      expect(body.items).toHaveLength(1);
      expect(body.items[0].subject).toBe(child.id);
    });

    test("reading needs audit:read, which keys:read does not imply", async () => {
      const reader = await service.keys.create("reader", [Claims.AuditRead]);
      const keysOnly = await service.keys.create("keys", [Claims.KeysRead]);

      expect((await app.request("/api/audit", { headers: auth(reader.secret) })).status).toBe(200);
      expect((await app.request("/api/audit", { headers: auth(keysOnly.secret) })).status).toBe(403);
      expect((await app.request("/api/audit")).status).toBe(401);
    });

    test("there is no way to write or delete an event through the API", async () => {
      for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
        const res = await app.request("/api/audit", { method, headers: auth(rootKey) });
        expect(res.status).toBe(404);
      }
    });
  });

  /**
   * D37's fourth finding, closed: a key minted through the API is bounded by
   * its minter's authority at the moment of minting and by nothing afterwards,
   * so without the link it outlives the key that vouched for it.
   */
  describe("descendant keys (D37 F4)", () => {
    test("revoking a key revokes what it minted, transitively", async () => {
      const parent = await mintVia(rootKey, "parent", [Claims.KeysCreate, Claims.MediaRead]);
      const child = await mintVia(parent.key, "child", [Claims.KeysCreate, Claims.MediaRead]);
      const grandchild = await mintVia(child.key, "grandchild", [Claims.MediaRead]);

      expect(child.parent_id).toBe(parent.id);
      expect(grandchild.parent_id).toBe(child.id);

      const res = await app.request(`/api/keys/${parent.id}`, {
        method: "DELETE",
        headers: auth(rootKey),
      });
      expect(res.status).toBe(204);

      const remaining = (await service.keys.list()).map((entry) => entry.id);
      expect(remaining).not.toContain(parent.id);
      expect(remaining).not.toContain(child.id);
      expect(remaining).not.toContain(grandchild.id);
      expect(remaining).toContain(rootId);
    });

    test("a sibling branch is untouched", async () => {
      const one = await mintVia(rootKey, "one", [Claims.KeysCreate, Claims.MediaRead]);
      const two = await mintVia(rootKey, "two", [Claims.MediaRead]);
      await mintVia(one.key, "one-child", [Claims.MediaRead]);

      await app.request(`/api/keys/${one.id}`, { method: "DELETE", headers: auth(rootKey) });

      const remaining = (await service.keys.list()).map((entry) => entry.id);
      expect(remaining).toContain(two.id);
      expect(remaining).toHaveLength(2);
    });

    test("the cascade is in the trail, since the 204 cannot carry it", async () => {
      const parent = await mintVia(rootKey, "parent", [Claims.KeysCreate, Claims.MediaRead]);
      const child = await mintVia(parent.key, "child", [Claims.MediaRead]);

      await app.request(`/api/keys/${parent.id}`, { method: "DELETE", headers: auth(rootKey) });

      const { items } = await service.audit.list({ subject: parent.id });
      const revoked = items.find((e) => e.action === "key.revoke")!;
      expect(revoked.detail.cascaded).toEqual([child.id]);
    });

    test("a key with no descendants revokes exactly itself", async () => {
      const lone = await mintVia(rootKey, "lone", [Claims.MediaRead]);
      const removed = await service.keys.revoke(lone.id);
      expect(removed).toEqual([lone.id]);
    });
  });
});
