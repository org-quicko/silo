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

/**
 * What each variables route asks for, and what it refuses (D57).
 *
 * A companion to `route-authority.test.ts` and written for its reason: these
 * routes introduce **no claim of their own**, so the only thing standing
 * between a narrow key and every environment's content is that each one asks at
 * the right reach. A route that asked at the environment for something that
 * reaches the project would be a way for a key scoped to `dev` to change what
 * `prod` answers.
 */
describe("variables route authority (D57)", () => {
  let tempDir: string;
  let store: SqliteStore;
  let service: SiloService;
  let app: Hono;

  const base = "/api/projects/default";
  const prodVars = `${base}/environments/prod/variables`;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-variables-authority-"));
    store = await SqliteStore.open(path.join(tempDir, "silo.db"));
    service = new SiloService(store, { mediaDir: path.join(tempDir, "media") });
    await service.keys.bootstrap();
    await service.scopes.initDefaults("default", "prod");
    await service.scopes.createEnvironment("default", "dev");
    await service.collections.putSchema(Scope.Default, "posts", { type: "object" });
    await service.variables.declare(Scope.Default, "API_URL", "", "https://prod.example.com");

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

  const mint = async (claims: string[]) => (await service.keys.create("probe", claims)).secret;
  const auth = (key: string) => ({ Authorization: `Bearer ${key}` });
  const json = (key: string) => ({ ...auth(key), "Content-Type": "application/json" });

  describe("reading", () => {
    test("entries:read on one collection in the environment is enough", async () => {
      const key = await mint([
        Claims.collection("default", "prod", "posts", Claims.CollectionEntriesRead),
      ]);
      const response = await app.request(prodVars, { headers: auth(key) });
      expect(response.status).toBe(200);
      expect(((await response.json()) as any).items[0].value).toBe("https://prod.example.com");
    });

    test("read in another environment does not reach this one", async () => {
      const key = await mint([
        Claims.collection("default", "dev", "posts", Claims.CollectionEntriesRead),
      ]);
      expect((await app.request(prodVars, { headers: auth(key) })).status).toBe(403);
    });

    test("a key with no read at all is refused rather than shown an empty list", async () => {
      const key = await mint([Claims.MediaRead]);
      const response = await app.request(prodVars, { headers: auth(key) });
      expect(response.status).toBe(403);
    });
  });

  describe("setting a value", () => {
    test("entries:update on one collection is not enough, because the reach is the scope", async () => {
      const key = await mint([
        Claims.collection("default", "prod", "posts", Claims.CollectionEntriesUpdate),
      ]);
      const response = await app.request(`${prodVars}/API_URL`, {
        method: "PUT",
        headers: json(key),
        body: JSON.stringify({ value: "https://sneaky.example.com" }),
      });
      expect(response.status).toBe(403);
      expect(((await response.json()) as any).error.message).toContain("entries:update");
    });

    test("scope-wide entries:update is enough", async () => {
      const key = await mint([
        Claims.collection("default", "prod", "*", Claims.CollectionEntriesUpdate),
      ]);
      const response = await app.request(`${prodVars}/API_URL`, {
        method: "PUT",
        headers: json(key),
        body: JSON.stringify({ value: "https://new.example.com" }),
      });
      expect(response.status).toBe(200);
    });

    test("scope-wide update in dev cannot value prod", async () => {
      const key = await mint([
        Claims.collection("default", "dev", "*", Claims.CollectionEntriesUpdate),
      ]);
      const response = await app.request(`${prodVars}/API_URL`, {
        method: "PUT",
        headers: json(key),
        body: JSON.stringify({ value: "https://sneaky.example.com" }),
      });
      expect(response.status).toBe(403);
    });

    test("clearing a value asks the same authority as setting one", async () => {
      const key = await mint([
        Claims.collection("default", "dev", "*", Claims.CollectionEntriesUpdate),
      ]);
      const response = await app.request(`${prodVars}/API_URL`, {
        method: "DELETE",
        headers: auth(key),
      });
      expect(response.status).toBe(403);
    });
  });

  describe("declaring", () => {
    test("a project-wide create is what declaring asks for", async () => {
      const scoped = await mint([
        Claims.collection("default", "prod", "*", Claims.CollectionCreate),
      ]);
      const refused = await app.request(`${base}/variables?env=prod`, {
        method: "POST",
        headers: json(scoped),
        body: JSON.stringify({ name: "NEW_ONE" }),
      });
      expect(refused.status).toBe(403);

      const wide = await mint([
        Claims.collection("default", "*", "*", Claims.CollectionCreate),
      ]);
      const allowed = await app.request(`${base}/variables?env=prod`, {
        method: "POST",
        headers: json(wide),
        body: JSON.stringify({ name: "NEW_ONE" }),
      });
      expect(allowed.status).toBe(201);
    });

    test("an initial value is held to the value authority as well as the declaration's", async () => {
      // Project-wide create, but nothing that may write prod's content.
      const key = await mint([
        Claims.collection("default", "*", "*", Claims.CollectionCreate),
      ]);
      const response = await app.request(`${base}/variables?env=prod`, {
        method: "POST",
        headers: json(key),
        body: JSON.stringify({ name: "SEEDED", value: "https://sneaky.example.com" }),
      });
      expect(response.status).toBe(403);
      expect(((await response.json()) as any).error.message).toContain("entries:update");

      // The declaration is not half-written by the refusal.
      const listed = await service.variables.list(Scope.Default);
      expect(listed.map((view) => view.name)).not.toContain("SEEDED");
    });

    test("undeclaring asks for a project-wide delete", async () => {
      const scoped = await mint([
        Claims.collection("default", "prod", "*", Claims.CollectionDelete),
      ]);
      expect(
        (
          await app.request(`${base}/variables/API_URL`, {
            method: "DELETE",
            headers: auth(scoped),
          })
        ).status,
      ).toBe(403);

      const wide = await mint([
        Claims.collection("default", "*", "*", Claims.CollectionDelete),
      ]);
      expect(
        (
          await app.request(`${base}/variables/API_URL`, {
            method: "DELETE",
            headers: auth(wide),
          })
        ).status,
      ).toBe(204);
    });

    test("a rename asks for both halves, create and delete", async () => {
      const createOnly = await mint([
        Claims.collection("default", "*", "*", Claims.CollectionCreate),
      ]);
      expect(
        (
          await app.request(`${base}/variables/API_URL`, {
            method: "PATCH",
            headers: json(createOnly),
            body: JSON.stringify({ name: "RENAMED" }),
          })
        ).status,
      ).toBe(403);

      const both = await mint([
        Claims.collection("default", "*", "*", Claims.CollectionCreate),
        Claims.collection("default", "*", "*", Claims.CollectionDelete),
      ]);
      expect(
        (
          await app.request(`${base}/variables/API_URL`, {
            method: "PATCH",
            headers: json(both),
            body: JSON.stringify({ name: "RENAMED" }),
          })
        ).status,
      ).toBe(200);
    });

    test("a description-only edit does not need the delete half", async () => {
      const key = await mint([
        Claims.collection("default", "*", "*", Claims.CollectionCreate),
      ]);
      const response = await app.request(`${base}/variables/API_URL`, {
        method: "PATCH",
        headers: json(key),
        body: JSON.stringify({ description: "Where the API lives" }),
      });
      expect(response.status).toBe(200);
    });
  });

  test("another project's authority reaches nothing here", async () => {
    await service.scopes.createProject("other");
    const key = await mint([Claims.collection("other", "*", "*", Claims.CollectionCreate)]);
    const response = await app.request(`${base}/variables?env=prod`, {
      method: "POST",
      headers: json(key),
      body: JSON.stringify({ name: "NOPE" }),
    });
    expect(response.status).toBe(403);
  });
});
