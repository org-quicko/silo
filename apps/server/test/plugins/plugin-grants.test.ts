import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { Claims } from "@silo/shared/claims";
import { SqliteStore } from "../../src/adapters/storage/sqlite/sqlite-store";
import { SiloService } from "../../src/core/services/silo-service";
import { Scope } from "../../src/core/domain/scope";
import { KeyUtils } from "../../src/core/keys/key-utils";
import type { KeyInfo } from "../../src/core/keys/key-info";
import { PluginGrantUtils } from "../../src/core/plugins/plugin-grant-utils";
import { AuditUtils } from "../../src/core/audit/audit-utils";

/** What `{}` used to mean before D38 made the actor explicit: the offline CLI,
 *  which holds no key and is bounded by filesystem access instead. */
const cli = { actor: AuditUtils.cli() };

/**
 * The grant model itself (D34): `_plugins`, the managed key, and the four
 * invariants that make approving a plugin mean something.
 *
 * Storage-level rather than through a worker — the loader's use of all this is
 * covered in `plugin-hooks.test.ts`, and what is under test here is the rule
 * set, which a running plugin would only obscure.
 */
describe("plugin grants", () => {
  let tempDir: string;
  let store: SqliteStore;
  let service: SiloService;

  const requested = [
    "collections:*/*/*:entries:read",
    "collections:*/*/*:entries:create",
    "hooks:*/*/*:entry.afterWrite",
  ];

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-grant-test-"));
    store = await SqliteStore.open(path.join(tempDir, "test.db"));
    service = new SiloService(store, { mediaDir: path.join(tempDir, "media") });
    await service.scopes.initDefaults();
  });

  afterEach(async () => {
    await store.close();
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  test("an unreconciled plugin starts pending, holding nothing", async () => {
    const grant = await service.plugins.reconcile("acme", requested, ["entry.afterWrite"]);

    expect(grant.state).toBe("pending");
    expect(grant.granted).toEqual([]);
    expect(grant.key_id).toBeUndefined();
    expect(grant.requested).toEqual(requested);
  });

  test("granting mints a managed key carrying exactly the approved claims", async () => {
    await service.plugins.reconcile("acme", requested, ["entry.afterWrite"]);
    const grant = await service.plugins.grant("acme", ["hooks:*/*/*:entry.afterWrite"], cli);

    expect(grant.state).toBe("granted");
    expect(grant.granted).toEqual(["hooks:*/*/*:entry.afterWrite"]);
    expect(grant.key_id).toBeTruthy();

    const keyEntry = await store.get(Scope.System, KeyUtils.KeysCollection, grant.key_id!);
    const info = keyEntry.data as KeyInfo;
    expect(info.owner).toEqual({ kind: "plugin", name: "acme" });
    expect(info.claims).toEqual(["hooks:*/*/*:entry.afterWrite"]);
  });

  /** Invariant one: a grant may not exceed the request. This is the check
   *  `PluginLoader.assertGranted` never had — it enforced only the converse. */
  test("a grant may not exceed what the manifest requested", async () => {
    await service.plugins.reconcile("acme", requested, ["entry.afterWrite"]);

    await expect(
      service.plugins.grant("acme", ["collections:*/*/*:entries:delete"], cli)
    ).rejects.toThrow(/did not request/);
  });

  test("a grant may narrow the scope the manifest asked for", async () => {
    await service.plugins.reconcile("acme", requested, ["entry.afterWrite"]);
    const grant = await service.plugins.grant("acme", ["hooks:blog/prod/posts:entry.afterWrite"], cli);

    expect(grant.granted).toEqual(["hooks:blog/prod/posts:entry.afterWrite"]);
  });

  /** Invariant two: the granter can only hand over what it holds. */
  test("a granting key cannot exceed its own authority", async () => {
    await service.plugins.reconcile("acme", requested, ["entry.afterWrite"]);

    await expect(
      service.plugins.grant("acme", ["collections:*/*/*:entries:create"], {
        claims: ["collections:blog/prod/posts:entries:create"],
        actor: cli.actor,
      })
    ).rejects.toThrow(/more authority than it holds/);

    // The same key granting within its reach is fine.
    const grant = await service.plugins.grant("acme", ["collections:blog/prod/posts:entries:create"], {
      claims: ["collections:blog/*/*:entries:create"],
      actor: { kind: "key" as const, id: "key-1" },
    });
    expect(grant.granted).toEqual(["collections:blog/prod/posts:entries:create"]);
    expect(grant.granted_by).toBe("key-1");
  });

  /** Invariant three: a plugin runs code, so it may never hold the authority to
   *  step outside its own grant. */
  test("a plugin can never be granted root or an escalation primitive", async () => {
    await service.plugins.reconcile("acme", [Claims.Root], []);
    await expect(service.plugins.grant("acme", [Claims.Root], cli)).rejects.toThrow(/cannot be granted root/);

    // Every member of the forbidden set, refused one at a time — the point of
    // the table is that it is complete, so asserting one member would let the
    // other five be dropped from it without a failure. D37 added the `keys:*`
    // half: those do not widen the grant record, they walk around it.
    for (const claim of Claims.PluginForbiddenClaims) {
      await service.plugins.reconcile("acme", [claim, Claims.PluginsRead], []);
      await expect(service.plugins.grant("acme", [claim], cli)).rejects.toThrow(
        /cannot be granted/
      );
    }

    // `plugins:read` is merely reading, and is allowed. So are `keys:read` and
    // `keys:export`: they disclose the authority map rather than change it, and
    // that is a trade-off an operator gets to make.
    await service.plugins.reconcile(
      "acme",
      [Claims.PluginsRead, Claims.KeysRead, Claims.KeysExport],
      []
    );
    const grant = await service.plugins.grant(
      "acme",
      [Claims.PluginsRead, Claims.KeysRead, Claims.KeysExport],
      cli
    );
    expect(grant.granted).toEqual([Claims.KeysExport, Claims.KeysRead, Claims.PluginsRead]);
  });

  /**
   * Invariant four, and the one that matters most: an upgrade asking for more
   * gets nothing until someone looks.
   */
  test("an upgrade that asks for more does not escalate", async () => {
    await service.plugins.reconcile("acme", ["collections:*/*/*:entries:read"], []);
    const granted = await service.plugins.grant("acme", ["collections:*/*/*:entries:read"], cli);
    expect(granted.state).toBe("granted");

    // The package now wants to delete, too.
    const upgraded = await service.plugins.reconcile(
      "acme",
      ["collections:*/*/*:entries:read", "collections:*/*/*:entries:delete"],
      []
    );

    expect(upgraded.state).toBe("needs_review");
    expect(upgraded.granted).toEqual(["collections:*/*/*:entries:read"]);
    expect(PluginGrantUtils.missing(upgraded.requested, upgraded.granted)).toEqual([
      "collections:*/*/*:entries:delete",
    ]);
  });

  test("needs_review survives a restart until it is approved", async () => {
    await service.plugins.reconcile("acme", ["collections:*/*/*:entries:read"], []);
    await service.plugins.grant("acme", ["collections:*/*/*:entries:read"], cli);

    const wider = ["collections:*/*/*:entries:read", "collections:*/*/*:entries:delete"];
    await service.plugins.reconcile("acme", wider, []);
    // A second start must not quietly settle it — the digest is deliberately
    // not advanced while a review is outstanding.
    const again = await service.plugins.reconcile("acme", wider, []);
    expect(again.state).toBe("needs_review");

    const approved = await service.plugins.grant("acme", wider, cli);
    expect(approved.state).toBe("granted");
    expect((await service.plugins.reconcile("acme", wider, [])).state).toBe("granted");
  });

  test("adding a hook is a change to the request, even at the same claims", async () => {
    await service.plugins.reconcile("acme", ["hooks:*/*/*:entry.afterWrite"], ["entry.afterWrite"]);
    await service.plugins.grant("acme", ["hooks:*/*/*:entry.afterWrite"], cli);

    const upgraded = await service.plugins.reconcile(
      "acme",
      ["hooks:*/*/*:entry.afterWrite"],
      ["entry.afterWrite", "entry.beforeValidate"]
    );
    expect(upgraded.state).toBe("needs_review");
  });

  test("revoking withdraws the key before the record", async () => {
    await service.plugins.reconcile("acme", requested, ["entry.afterWrite"]);
    const granted = await service.plugins.grant("acme", ["hooks:*/*/*:entry.afterWrite"], cli);

    const revoked = await service.plugins.revoke("acme", { actor: { kind: "key", id: "key-9" } });
    expect(revoked.state).toBe("revoked");
    expect(revoked.granted).toEqual([]);
    expect(revoked.key_id).toBeUndefined();
    expect(revoked.granted_by).toBe("key-9");

    await expect(
      store.get(Scope.System, KeyUtils.KeysCollection, granted.key_id!)
    ).rejects.toThrow();
  });

  test("re-granting replaces the key rather than leaving the old one live", async () => {
    await service.plugins.reconcile("acme", requested, ["entry.afterWrite"]);
    const first = await service.plugins.grant("acme", ["hooks:*/*/*:entry.afterWrite"], cli);
    const second = await service.plugins.grant("acme", ["collections:*/*/*:entries:read"], cli);

    expect(second.key_id).not.toBe(first.key_id);
    await expect(store.get(Scope.System, KeyUtils.KeysCollection, first.key_id!)).rejects.toThrow();
  });

  test("granting a plugin that was never reconciled is refused", async () => {
    await expect(service.plugins.grant("ghost", [], cli)).rejects.toThrow(/not known to this instance/);
  });
});

describe("managed keys", () => {
  let tempDir: string;
  let store: SqliteStore;
  let service: SiloService;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-managed-key-"));
    store = await SqliteStore.open(path.join(tempDir, "test.db"));
    service = new SiloService(store, { mediaDir: path.join(tempDir, "media") });
    await service.scopes.initDefaults();
  });

  afterEach(async () => {
    await store.close();
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  test("a managed key cannot be revoked through the ordinary path", async () => {
    await service.plugins.reconcile("acme", ["collections:*/*/*:entries:read"], []);
    const grant = await service.plugins.grant("acme", ["collections:*/*/*:entries:read"], cli);

    await expect(service.keys.revoke(grant.key_id!)).rejects.toThrow(/managed by silo/);
    // Still there, and still usable — a refusal that half-worked would be worse
    // than either outcome.
    const still = await store.get(Scope.System, KeyUtils.KeysCollection, grant.key_id!);
    expect(still.id).toBe(grant.key_id!);
  });

  /**
   * An instance whose only keys are managed has no way in at all, and would
   * previously have reported itself as already bootstrapped.
   */
  test("a managed key does not count as bootstrapping the instance", async () => {
    await service.plugins.reconcile("acme", ["collections:*/*/*:entries:read"], []);
    await service.plugins.grant("acme", ["collections:*/*/*:entries:read"], cli);

    const secret = await service.keys.bootstrap();
    expect(secret).toBeTruthy();

    // And once a real key exists, bootstrap goes quiet again.
    expect(await service.keys.bootstrap()).toBe("");
  });

  test("an ordinary key still revokes", async () => {
    const { entry } = await service.keys.create("mine", [Claims.MediaRead]);
    await service.keys.revoke(entry.id);
    await expect(store.get(Scope.System, KeyUtils.KeysCollection, entry.id)).rejects.toThrow();
  });
});
