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
 * The plugin management API (D38, phase 2).
 *
 * What it manages is the `_plugins` **record**, never the package: every route
 * here reads and writes the store and nothing touches the filesystem, which is
 * D34's registration/authorization split holding at the HTTP layer too.
 */
describe("plugin management API (D38)", () => {
  let tempDir: string;
  let store: SqliteStore;
  let service: SiloService;
  let app: Hono;
  let rootKey: string;

  // Already in `Claims.normalize` order, because a grant comes back normalized
  // and a fixture that was not would make every assertion about it a sort.
  const requested = [
    "collections:*/*/*:entries:create",
    "collections:*/*/*:entries:read",
    "hooks:*/*/*:entry.afterWrite",
  ];

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-plugin-mgmt-"));
    store = await SqliteStore.open(path.join(tempDir, "silo.db"));
    service = new SiloService(store, { mediaDir: path.join(tempDir, "media") });
    rootKey = await service.keys.bootstrap();
    await service.plugins.reconcile("acme", requested, ["entry.afterWrite"]);
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
  const at = (key: string, rev: number) => ({
    ...auth(key),
    "Content-Type": "application/json",
    "If-Match": `"${rev}"`,
  });
  const read = async (key = rootKey) => {
    const res = await app.request("/api/plugins/acme", { headers: auth(key) });
    return (await res.json()) as any;
  };

  describe("reading", () => {
    test("a listing shows the request, the grant, and the gap between them", async () => {
      const res = await app.request("/api/plugins", { headers: auth(rootKey) });
      expect(res.status).toBe(200);

      const body = (await res.json()) as any;
      expect(body.items).toHaveLength(1);
      const [view] = body.items;
      expect(view.name).toBe("acme");
      expect(view.state).toBe("pending");
      expect(view.enabled).toBe(true);
      expect(view.requested).toEqual(requested);
      expect(view.granted).toEqual([]);
      // The reviewable part, computed server-side so a client is not a second
      // implementation of the wildcard-aware comparison.
      expect(view.not_granted).toEqual(requested);
      expect(view.key_id).toBeNull();
      expect(view.rev).toBe(1);
    });

    test("reading needs plugins:read and nothing wider", async () => {
      const reader = await mint([Claims.PluginsRead]);
      expect((await app.request("/api/plugins", { headers: auth(reader) })).status).toBe(200);

      const stranger = await mint([Claims.MediaRead]);
      expect((await app.request("/api/plugins", { headers: auth(stranger) })).status).toBe(403);
      expect((await app.request("/api/plugins")).status).toBe(401);
    });

    test("one plugin carries its revision as an ETag", async () => {
      const res = await app.request("/api/plugins/acme", { headers: auth(rootKey) });
      expect(res.headers.get("ETag")).toBe('"1"');
    });

    /**
     * Reconciling runs for every plugin at every start, so a write that changed
     * nothing would still bump the revision — invalidating every `If-Match` an
     * operator held, for a change they could not point at. Measured on a real
     * instance where four restarts walked one plugin from rev 1 to rev 7.
     */
    test("reconciling an unchanged plugin does not move its revision", async () => {
      for (let restart = 0; restart < 3; restart++) {
        await service.plugins.reconcile("acme", requested, ["entry.afterWrite"]);
      }
      expect((await read()).rev).toBe(1);

      // A genuine change still moves it.
      await service.plugins.reconcile("acme", [...requested, "media:read"], ["entry.afterWrite"]);
      expect((await read()).rev).toBe(2);
    });
  });

  describe("granting", () => {
    test("an empty body approves everything requested", async () => {
      const res = await app.request("/api/plugins/acme/grant", {
        method: "PUT",
        headers: at(rootKey, 1),
      });
      expect(res.status).toBe(200);

      const view = (await res.json()) as any;
      expect(view.state).toBe("granted");
      expect(view.granted).toEqual(requested);
      expect(view.not_granted).toEqual([]);
      expect(view.key_id).toBeTruthy();
    });

    test("a body narrows, and the narrowing is visible as not_granted", async () => {
      const res = await app.request("/api/plugins/acme/grant", {
        method: "PUT",
        headers: at(rootKey, 1),
        body: JSON.stringify({ claims: ["hooks:blog/prod/posts:entry.afterWrite"] }),
      });
      const view = (await res.json()) as any;
      expect(view.granted).toEqual(["hooks:blog/prod/posts:entry.afterWrite"]);
      // The narrowed hook claim is in `not_granted` too, and that is correct
      // rather than a rounding error: the plugin asked to be delivered the hook
      // *everywhere* and got one collection, so the request is genuinely not
      // granted in full. Calling a narrowing "satisfied" would train an operator
      // to read the field as noise — which is why the CLI words the same list
      // as "requested, and not granted in full".
      expect(view.not_granted).toEqual([
        "collections:*/*/*:entries:create",
        "collections:*/*/*:entries:read",
        "hooks:*/*/*:entry.afterWrite",
      ]);
    });

    test("granting records who did it", async () => {
      const keys = await service.keys.list();
      const rootId = keys.find((e) => (e.data as any).label === "root")!.id;

      await app.request("/api/plugins/acme/grant", { method: "PUT", headers: at(rootKey, 1) });
      expect((await read()).granted_by).toBe(rootId);
    });

    test("a grant cannot exceed what the granting key holds", async () => {
      const narrow = await mint([
        Claims.PluginsGrant,
        "collections:blog/prod/posts:entries:read",
      ]);
      const res = await app.request("/api/plugins/acme/grant", {
        method: "PUT",
        headers: at(narrow, 1),
        body: JSON.stringify({ claims: ["collections:*/*/*:entries:read"] }),
      });
      expect(res.status).toBe(403);
      expect((await res.json() as any).error.message).toContain("more authority than it holds");
    });

    test("granting needs plugins:grant, which plugins:read does not imply", async () => {
      const reader = await mint([Claims.PluginsRead]);
      const res = await app.request("/api/plugins/acme/grant", {
        method: "PUT",
        headers: at(reader, 1),
      });
      expect(res.status).toBe(403);
    });

    test("PUT is idempotent — the same body twice grants the same thing", async () => {
      const first = await app.request("/api/plugins/acme/grant", {
        method: "PUT",
        headers: at(rootKey, 1),
        body: JSON.stringify({ claims: ["hooks:*/*/*:entry.afterWrite"] }),
      });
      const one = (await first.json()) as any;

      const second = await app.request("/api/plugins/acme/grant", {
        method: "PUT",
        headers: at(rootKey, one.rev),
        body: JSON.stringify({ claims: ["hooks:*/*/*:entry.afterWrite"] }),
      });
      const two = (await second.json()) as any;
      expect(two.granted).toEqual(one.granted);
      // A fresh key each time, which is the D34 rotation and not a duplicate.
      expect(two.key_id).not.toBe(one.key_id);
    });

    test("revoking withdraws the grant and the key", async () => {
      await app.request("/api/plugins/acme/grant", { method: "PUT", headers: at(rootKey, 1) });
      const granted = await read();

      const res = await app.request("/api/plugins/acme/grant", {
        method: "DELETE",
        headers: at(rootKey, granted.rev),
      });
      expect(res.status).toBe(200);

      const view = (await res.json()) as any;
      expect(view.state).toBe("revoked");
      expect(view.granted).toEqual([]);
      expect(view.key_id).toBeNull();
      await expect(service.keys.find(granted.key_id)).rejects.toThrow();
    });
  });

  /**
   * The reason `If-Match` is required rather than optional on a grant: approving
   * means approving **what you read**. Without the fence, a package whose
   * request changed between the read and the approval would be approved on the
   * strength of the older one — the exact substitution `needs_review` exists to
   * catch, arriving through the API instead of through an upgrade.
   */
  describe("revisions", () => {
    test("a mutation without If-Match is refused", async () => {
      const res = await app.request("/api/plugins/acme/grant", {
        method: "PUT",
        headers: { ...auth(rootKey), "Content-Type": "application/json" },
      });
      expect(res.status).toBe(400);
      expect((await res.json() as any).error.message).toContain("If-Match");
    });

    /**
     * "Changes nothing" has to include the **key**, which is where an earlier
     * version of this got it wrong: a stale grant discarded the live managed key
     * and minted a replacement before the revision was checked, so a 409 left
     * the record pointing at a key that no longer existed and an orphan behind
     * it. Found by a smoke test, not by this file, which is why the assertions
     * below reach past the record into `_keys`.
     */
    test("a stale If-Match is a 409 and changes nothing, the key included", async () => {
      await app.request("/api/plugins/acme/grant", { method: "PUT", headers: at(rootKey, 1) });
      const granted = await read();

      const stale = await app.request("/api/plugins/acme/grant", {
        method: "PUT",
        headers: at(rootKey, 1),
        body: JSON.stringify({ claims: [] }),
      });
      expect(stale.status).toBe(409);
      expect((await read()).granted).toEqual(requested);

      // The recorded key is unchanged and still resolves.
      expect((await read()).key_id).toBe(granted.key_id);
      expect((await service.keys.find(granted.key_id)).claims).toEqual(requested);

      // And no orphan was left: exactly one key belongs to this plugin.
      const managed = (await service.keys.list()).filter(
        (entry) => (entry.data as any).owner?.name === "acme"
      );
      expect(managed.map((entry) => entry.id)).toEqual([granted.key_id]);
    });

    test("a stale revoke does not destroy the key on its way to a 409", async () => {
      await app.request("/api/plugins/acme/grant", { method: "PUT", headers: at(rootKey, 1) });
      const granted = await read();

      const stale = await app.request("/api/plugins/acme/grant", {
        method: "DELETE",
        headers: at(rootKey, 1),
      });
      expect(stale.status).toBe(409);
      expect((await service.keys.find(granted.key_id)).claims).toEqual(requested);
    });

    test("approving what someone else already changed is refused", async () => {
      // Two operators read revision 1. One grants.
      const seenByBoth = (await read()).rev;
      await app.request("/api/plugins/acme/grant", {
        method: "PUT",
        headers: at(rootKey, seenByBoth),
        body: JSON.stringify({ claims: ["hooks:*/*/*:entry.afterWrite"] }),
      });

      // The other approves the request *they* read, and is told to look again.
      const second = await app.request("/api/plugins/acme/grant", {
        method: "PUT",
        headers: at(rootKey, seenByBoth),
      });
      expect(second.status).toBe(409);
      expect((await read()).granted).toEqual(["hooks:*/*/*:entry.afterWrite"]);
    });
  });

  describe("enable and disable", () => {
    test("disabling is orthogonal to the grant", async () => {
      await app.request("/api/plugins/acme/grant", { method: "PUT", headers: at(rootKey, 1) });
      const granted = await read();

      const res = await app.request("/api/plugins/acme/disable", {
        method: "POST",
        headers: at(rootKey, granted.rev),
      });
      expect(res.status).toBe(200);

      const view = (await res.json()) as any;
      expect(view.enabled).toBe(false);
      // Pausing is not un-approving: the claims and the key both survive, or an
      // operator would learn to grant widely to avoid re-approving.
      expect(view.state).toBe("granted");
      expect(view.granted).toEqual(requested);
      expect(view.key_id).toBe(granted.key_id);
    });

    /**
     * `restart_required: true` is gone (D39, phase 4). It was there because it
     * was true, and the replacement is not a `false` in the same field — a flag
     * that is always false is noise — but `runtime`, which says what actually
     * happened.
     *
     * This process has no `silo.toml` and therefore lists no plugins, so the
     * blocking fact is not that the plugin was just disabled but that nothing
     * would load it either way — and the more actionable of two true reasons is
     * the one `detail` gives.
     */
    test("the response says what is running, not that a restart is needed", async () => {
      const res = await app.request("/api/plugins/acme/disable", {
        method: "POST",
        headers: at(rootKey, 1),
      });
      const view = (await res.json()) as any;
      expect(view.restart_required).toBeUndefined();
      expect(view.runtime.state).toBe("stopped");
      expect(view.runtime.detail).toContain("not listed in silo.toml");
    });

    test("enabling again clears it", async () => {
      const off = await app.request("/api/plugins/acme/disable", {
        method: "POST",
        headers: at(rootKey, 1),
      });
      const disabled = (await off.json()) as any;

      const on = await app.request("/api/plugins/acme/enable", {
        method: "POST",
        headers: at(rootKey, disabled.rev),
      });
      expect((await on.json() as any).enabled).toBe(true);
    });

    test("enabling needs plugins:enable, which plugins:grant does not imply", async () => {
      const granter = await mint([Claims.PluginsGrant]);
      const res = await app.request("/api/plugins/acme/disable", {
        method: "POST",
        headers: at(granter, 1),
      });
      expect(res.status).toBe(403);
    });
  });

  test("an unknown plugin is refused before anything is written", async () => {
    const res = await app.request("/api/plugins/ghost/grant", {
      method: "PUT",
      headers: at(rootKey, 1),
    });
    expect(res.status).toBe(404);
    expect((await service.plugins.list()).map((p) => p.name)).toEqual(["acme"]);
  });
});
