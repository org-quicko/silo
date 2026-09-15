import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { Hono } from "hono";
import { Claims } from "@silo/shared/claims";
import { SqliteStore } from "../../src/adapters/storage/sqlite/sqlite-store";
import { SiloService } from "../../src/core/services/silo-service";
import { Scope } from "../../src/core/domain/scope";
import { SiloServer } from "../../src/http/server";
import { Logger } from "../../src/logging/logger";

/** The fields these cases read off a key response. */
interface KeyBody {
  id: string;
  label: string;
  claims: string[];
  prefix: string;
  created_at: string;
  updated_at: string;
}

interface AuditBody {
  items: {
    action: string;
    subject: string;
    detail: Record<string, unknown>;
  }[];
}

interface ErrorBody {
  error?: { message?: string };
  message?: string;
}

describe("PATCH /api/keys/:id", () => {
  let tempDir: string;
  let store: SqliteStore;
  let service: SiloService;
  let app: Hono;
  let rootKey: string;

  const headersFor = (secret: string) => ({
    Authorization: `Bearer ${secret}`,
    "Content-Type": "application/json",
  });

  const patch = (secret: string, id: string, body: unknown) =>
    app.request(`/api/keys/${id}`, {
      method: "PATCH",
      headers: headersFor(secret),
      body: JSON.stringify(body),
    });

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-key-edit-test-"));
    store = await SqliteStore.open(path.join(tempDir, "silo.db"));
    service = new SiloService(store, { mediaDir: path.join(tempDir, "media") });
    rootKey = await service.keys.bootstrap();
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

  test("renames a key without touching its claims or its secret", async () => {
    const claims = [Claims.collection("default", "prod", "posts", Claims.CollectionEntriesRead)];
    const { secret, entry } = await service.keys.create("frontend", claims);

    const response = await patch(rootKey, entry.id, { label: "web-frontend" });
    expect(response.status).toBe(200);

    const body = (await response.json()) as KeyBody;
    expect(body.label).toBe("web-frontend");
    expect(body.claims).toEqual(claims);
    expect(body.updated_at >= body.created_at).toBe(true);

    // The point of an edit is that the credential keeps working.
    const session = await app.request("/api/session", { headers: headersFor(secret) });
    expect(session.status).toBe(200);
  });

  test("replaces the claim list outright rather than merging into it", async () => {
    const { entry } = await service.keys.create("frontend", [
      Claims.collection("default", "prod", "posts", Claims.CollectionEntriesRead),
      Claims.collection("default", "prod", "posts", Claims.CollectionEntriesDelete),
    ]);

    const next = [Claims.collection("default", "prod", "posts", Claims.CollectionEntriesRead)];
    const body = (await (await patch(rootKey, entry.id, { claims: next })).json()) as KeyBody;
    expect(body.claims).toEqual(next);
  });

  test("the new claims take effect on the already-issued secret", async () => {
    await service.collections.putSchema(Scope.Default, "posts", {
      type: "object",
      "x-silo-auth": true,
    });
    const { secret, entry } = await service.keys.create("frontend", [
      Claims.collection("default", "prod", "posts", Claims.CollectionSchemaRead),
    ]);
    const url = "/api/projects/default/environments/prod/collections/posts/schema";
    expect((await app.request(url, { headers: headersFor(secret) })).status).toBe(200);

    await patch(rootKey, entry.id, { claims: [] });
    expect((await app.request(url, { headers: headersFor(secret) })).status).toBe(403);
  });

  test("a caller cannot give a key claims it does not hold itself", async () => {
    const minter = await service.keys.create("minter", [
      Claims.KeysCreate,
      Claims.collection("default", "prod", "posts", Claims.CollectionEntriesRead),
    ]);
    const target = await service.keys.create("target", [
      Claims.collection("default", "prod", "posts", Claims.CollectionEntriesRead),
    ]);

    const response = await patch(minter.secret, target.entry.id, {
      claims: [Claims.collection("default", "prod", "posts", Claims.CollectionEntriesDelete)],
    });
    expect(response.status).toBe(403);
  });

  /**
   * D37's finding with the verb changed: without a bound against what the
   * *target* holds, the narrowest key carrying `keys:create` could rewrite the
   * root key down to nothing and lock the instance out.
   */
  test("a caller cannot edit a key more powerful than itself", async () => {
    const minter = await service.keys.create("minter", [
      Claims.KeysCreate,
      Claims.collection("default", "prod", "posts", Claims.CollectionEntriesRead),
    ]);
    const keys = await service.keys.list();
    const root = keys.find((entry) => (entry.data as { claims: string[] }).claims.includes("*"))!;

    const response = await patch(minter.secret, root.id, { label: "seized" });
    expect(response.status).toBe(403);

    const still = await service.keys.find(root.id);
    expect(still.label).toBe("root");
  });

  test("a key may narrow itself but not widen itself", async () => {
    const own = [
      Claims.KeysCreate,
      Claims.collection("default", "prod", "posts", Claims.CollectionEntriesRead),
      Claims.collection("default", "prod", "posts", Claims.CollectionEntriesUpdate),
    ];
    const { secret, entry } = await service.keys.create("self", own);

    const narrowed = await patch(secret, entry.id, {
      claims: [Claims.KeysCreate, Claims.collection("default", "prod", "posts", Claims.CollectionEntriesRead)],
    });
    expect(narrowed.status).toBe(200);

    const widened = await patch(secret, entry.id, {
      claims: [...own, Claims.collection("default", "prod", "posts", Claims.CollectionEntriesDelete)],
    });
    expect(widened.status).toBe(403);
  });

  test("keys:create is required, and keys:revoke is not a substitute", async () => {
    const { entry } = await service.keys.create("target", []);
    const revoker = await service.keys.create("revoker", [Claims.KeysRevoke, Claims.KeysRead]);

    const response = await patch(revoker.secret, entry.id, { label: "renamed" });
    expect(response.status).toBe(403);
  });

  test("an empty body and a blank label are both refused", async () => {
    const { entry } = await service.keys.create("frontend", []);
    expect((await patch(rootKey, entry.id, {})).status).toBe(400);
    expect((await patch(rootKey, entry.id, { label: "   " })).status).toBe(400);
  });

  test("an unknown claim is refused and nothing is written", async () => {
    const claims = [Claims.collection("default", "prod", "posts", Claims.CollectionEntriesRead)];
    const { entry } = await service.keys.create("frontend", claims);

    const response = await patch(rootKey, entry.id, { claims: ["collections:read"] });
    expect(response.status).toBe(400);
    expect((await service.keys.find(entry.id)).claims).toEqual(claims);
  });

  /** A managed key's claims *are* its plugin's grant, and silo re-mints it at
   *  the next start, so an edit here would undo itself. */
  test("a plugin's managed key is refused, naming the command that works", async () => {
    const { entry } = await service.keys.create("strapi", [Claims.PluginsRead], {
      owner: { kind: "plugin", name: "strapi-import" },
    });

    const response = await patch(rootKey, entry.id, { label: "renamed" });
    expect(response.status).toBe(400);

    const body = (await response.json()) as ErrorBody;
    const message = body.error?.message ?? body.message ?? "";
    expect(message).toContain("strapi-import");
  });

  test("the trail records both sides of the change", async () => {
    const before = [Claims.collection("default", "prod", "posts", Claims.CollectionEntriesRead)];
    const after = [Claims.collection("default", "prod", "posts", Claims.CollectionEntriesUpdate)];
    const { entry } = await service.keys.create("frontend", before);

    await patch(rootKey, entry.id, { label: "web", claims: after });

    const trail = (await (
      await app.request(`/api/audit?subject=${entry.id}`, { headers: headersFor(rootKey) })
    ).json()) as AuditBody;
    const event = trail.items.find((item) => item.action === "key.update")!;

    expect(event.subject).toBe(entry.id);
    expect(event.detail.label_from).toBe("frontend");
    expect(event.detail.label_to).toBe("web");
    expect(event.detail.claims_from).toEqual(before);
    expect(event.detail.claims_to).toEqual(after);
  });

  test("editing a key leaves the keys it minted alone", async () => {
    const parent = await service.keys.create("parent", [
      Claims.KeysCreate,
      Claims.collection("default", "prod", "posts", Claims.CollectionEntriesRead),
      Claims.collection("default", "prod", "posts", Claims.CollectionEntriesUpdate),
    ]);
    const child = await app.request("/api/keys", {
      method: "POST",
      headers: headersFor(parent.secret),
      body: JSON.stringify({
        label: "child",
        claims: [Claims.collection("default", "prod", "posts", Claims.CollectionEntriesUpdate)],
      }),
    });
    const childId = ((await child.json()) as KeyBody).id;

    await patch(rootKey, parent.entry.id, {
      claims: [Claims.collection("default", "prod", "posts", Claims.CollectionEntriesRead)],
    });

    // Narrowing a parent grants a descendant nothing new, and re-bounding it
    // here would make revocation and editing two theories of `parent_id` (D38).
    expect((await service.keys.find(childId)).claims).toEqual([
      Claims.collection("default", "prod", "posts", Claims.CollectionEntriesUpdate),
    ]);
  });
});
