import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { Hono } from "hono";
import { SqliteStore } from "../../src/adapters/storage/sqlite/sqlite-store";
import { SiloService } from "../../src/core/services/silo-service";
import { Scope } from "../../src/core/domain/scope";
import { SiloServer } from "../../src/http/server";
import { Logger } from "../../src/logging/logger";

/**
 * Variables end to end: declared per project, valued per environment,
 * substituted on the way out (D57).
 *
 * Runs with auth disabled, so every caller is root — what is under test here is
 * the behaviour, not the gate. `route-authority.test.ts`'s companion cases
 * cover which claim each route asks for.
 */
describe("Variables API", () => {
  let tempDir: string;
  let store: SqliteStore;
  let service: SiloService;
  let app: Hono;

  const project = Scope.Default.project;
  const prod = Scope.Default.env;

  const base = `/api/projects/${project}`;
  const envBase = `${base}/environments/${prod}`;

  async function request(method: string, url: string, body?: unknown): Promise<Response> {
    return app.request(url, {
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  async function declare(name: string, value?: string, description = ""): Promise<Response> {
    return request("POST", `${base}/variables?env=${prod}`, { name, description, value });
  }

  /** A collection whose fields are free text, so a template can be stored. */
  async function seedCollection(
    name = "pages",
    scopeBase = envBase,
    properties: Record<string, unknown> = {
      title: { type: "string" },
      body: { type: "string" },
    },
  ): Promise<void> {
    const response = await request("POST", `${scopeBase}/collections`, {
      name,
      schema: { type: "object", properties },
    });
    expect(response.status).toBe(201);
  }

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-variables-test-"));
    store = await SqliteStore.open(path.join(tempDir, "test.db"));
    service = new SiloService(store);
    await service.scopes.initDefaults(project, prod);
    app = new SiloServer(service, {
      version: "test",
      authDisabled: true,
      logger: Logger.silent(),
    }).build();
  });

  afterEach(async () => {
    await store.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("declaring and valuing", () => {
    test("a declaration is answered with this environment's view of it", async () => {
      const response = await declare("API_URL", "https://prod.example.com", "Where the API lives");
      expect(response.status).toBe(201);
      expect(await response.json()).toMatchObject({
        name: "API_URL",
        description: "Where the API lives",
        value: "https://prod.example.com",
        set_in: 1,
      });
    });

    test("declaring the same name twice in a project is a conflict", async () => {
      expect((await declare("API_URL", "a")).status).toBe(201);
      expect((await declare("API_URL", "b")).status).toBe(409);
    });

    test("a name that is not a legal variable name is refused", async () => {
      expect((await declare("api-url", "x")).status).toBe(400);
      expect((await declare("9LIVES", "x")).status).toBe(400);
      expect((await declare("", "x")).status).toBe(400);
    });

    test("a value may be blank but must be a string", async () => {
      expect((await declare("BLANK", "")).status).toBe(201);
      const bad = await request("POST", `${base}/variables?env=${prod}`, {
        name: "PORT",
        value: 8080,
      });
      expect(bad.status).toBe(400);
    });

    test("the name is declared once and the value is per environment", async () => {
      await request("POST", `${base}/environments`, { id: "staging" });
      await declare("API_URL", "https://prod.example.com");

      const staging = `${base}/environments/staging/variables`;
      // Declared for the whole project, so staging already knows the name and
      // has no value for it.
      expect(await (await request("GET", staging)).json()).toEqual({
        items: [
          expect.objectContaining({ name: "API_URL", value: null, set_in: 1 }),
        ],
      });

      await request("PUT", `${staging}/API_URL`, { value: "https://staging.example.com" });

      const inStaging = await (await request("GET", staging)).json();
      const inProd = await (await request("GET", `${envBase}/variables`)).json();
      expect(inStaging.items[0].value).toBe("https://staging.example.com");
      expect(inProd.items[0].value).toBe("https://prod.example.com");
      expect(inProd.items[0].set_in).toBe(2);
    });

    test("clearing a value leaves the name declared and unset", async () => {
      await declare("API_URL", "https://prod.example.com");
      const cleared = await request("DELETE", `${envBase}/variables/API_URL`);
      expect(cleared.status).toBe(200);
      expect(await cleared.json()).toMatchObject({ name: "API_URL", value: null, set_in: 0 });

      const list = await (await request("GET", `${envBase}/variables`)).json();
      expect(list.items).toHaveLength(1);
    });

    test("undeclaring removes the name from every environment", async () => {
      await request("POST", `${base}/environments`, { id: "staging" });
      await declare("API_URL", "https://prod.example.com");

      expect((await request("DELETE", `${base}/variables/API_URL`)).status).toBe(204);

      for (const env of [prod, "staging"]) {
        const list = await (
          await request("GET", `${base}/environments/${env}/variables`)
        ).json();
        expect(list.items).toEqual([]);
      }
    });

    test("setting a value on an undeclared name is a 404, not a silent declare", async () => {
      const response = await request("PUT", `${envBase}/variables/NOPE`, { value: "x" });
      expect(response.status).toBe(404);
    });

    test("a rename refuses a name already declared, and carries the value across", async () => {
      await declare("OLD", "kept");
      await declare("TAKEN", "other");

      expect(
        (await request("PATCH", `${base}/variables/OLD`, { name: "TAKEN" })).status,
      ).toBe(409);

      const renamed = await request("PATCH", `${base}/variables/OLD`, { name: "NEW" });
      expect(renamed.status).toBe(200);
      expect(await renamed.json()).toMatchObject({ name: "NEW", value: "kept" });
    });

    test("the list is sorted by name, so the page does not reshuffle on save", async () => {
      await declare("ZULU");
      await declare("ALPHA");
      await declare("MIKE");

      const list = await (await request("GET", `${envBase}/variables`)).json();
      expect(list.items.map((item: { name: string }) => item.name)).toEqual([
        "ALPHA",
        "MIKE",
        "ZULU",
      ]);
    });

    test("`/envs` is the same route as `/environments`", async () => {
      await declare("API_URL", "https://prod.example.com");
      const short = await request("GET", `${base}/envs/${prod}/variables`);
      expect(short.status).toBe(200);
      expect((await short.json()).items[0].value).toBe("https://prod.example.com");
    });
  });

  describe("substitution in entry responses", () => {
    beforeEach(async () => {
      await seedCollection();
      await declare("API_URL", "https://prod.example.com");
    });

    async function createEntry(data: Record<string, unknown>): Promise<string> {
      const response = await request("POST", `${envBase}/collections/pages`, data);
      expect(response.status).toBe(201);
      return (await response.json()).id;
    }

    test("a read substitutes, and the stored text is untouched", async () => {
      const id = await createEntry({ title: "Docs", body: "Call {{API_URL}}/v1 today" });

      const resolved = await (await request("GET", `${envBase}/collections/pages/${id}`)).json();
      expect(resolved.body).toBe("Call https://prod.example.com/v1 today");

      const raw = await (
        await request("GET", `${envBase}/collections/pages/${id}?variables=raw`)
      ).json();
      expect(raw.body).toBe("Call {{API_URL}}/v1 today");
    });

    test("a list substitutes every entry on the page", async () => {
      await createEntry({ title: "One", body: "{{API_URL}}/a" });
      await createEntry({ title: "Two", body: "{{API_URL}}/b" });

      const page = await (await request("GET", `${envBase}/collections/pages`)).json();
      expect(page.data.map((entry: { body: string }) => entry.body).sort()).toEqual([
        "https://prod.example.com/a",
        "https://prod.example.com/b",
      ]);
    });

    test("a create echoes the resolved value the same as a read of it", async () => {
      const response = await request("POST", `${envBase}/collections/pages`, {
        title: "Docs",
        body: "{{API_URL}}",
      });
      expect((await response.json()).body).toBe("https://prod.example.com");
    });

    test("an undeclared name is left standing rather than blanked", async () => {
      const id = await createEntry({ title: "Docs", body: "{{API_URL}} and {{MISSING}}" });
      const resolved = await (await request("GET", `${envBase}/collections/pages/${id}`)).json();
      expect(resolved.body).toBe("https://prod.example.com and {{MISSING}}");
    });

    test("a declared but unset name is also left standing", async () => {
      await request("POST", `${base}/environments`, { id: "staging" });
      const stagingBase = `${base}/environments/staging`;
      await seedCollection("pages", stagingBase, { body: { type: "string" } });
      const created = await request("POST", `${stagingBase}/collections/pages`, {
        body: "{{API_URL}}",
      });
      const id = (await created.json()).id;

      const resolved = await (
        await request("GET", `${stagingBase}/collections/pages/${id}`)
      ).json();
      expect(resolved.body).toBe("{{API_URL}}");
    });

    test("substitution reaches nested objects and arrays, but never a key", async () => {
      await seedCollection("nested", envBase, {
        links: { type: "array", items: { type: "string" } },
        meta: { type: "object", properties: { home: { type: "string" } } },
      });
      const created = await request("POST", `${envBase}/collections/nested`, {
        links: ["{{API_URL}}/a", "plain"],
        meta: { home: "{{API_URL}}" },
      });
      const id = (await created.json()).id;

      const resolved = await (await request("GET", `${envBase}/collections/nested/${id}`)).json();
      expect(resolved.links).toEqual(["https://prod.example.com/a", "plain"]);
      expect(resolved.meta).toEqual({ home: "https://prod.example.com" });
    });

    test("changing a value changes what every referencing entry answers", async () => {
      const id = await createEntry({ title: "Docs", body: "{{API_URL}}" });
      await request("PUT", `${envBase}/variables/API_URL`, { value: "https://new.example.com" });

      const resolved = await (await request("GET", `${envBase}/collections/pages/${id}`)).json();
      expect(resolved.body).toBe("https://new.example.com");
    });

    test("an empty value substitutes as empty rather than reading as unset", async () => {
      await declare("SUFFIX", "");
      const id = await createEntry({ title: "Docs", body: "path{{SUFFIX}}!" });
      const resolved = await (await request("GET", `${envBase}/collections/pages/${id}`)).json();
      expect(resolved.body).toBe("path!");
    });

    test("an unrecognised ?variables= is refused rather than guessed", async () => {
      const id = await createEntry({ title: "Docs", body: "{{API_URL}}" });
      const response = await request(
        "GET",
        `${envBase}/collections/pages/${id}?variables=false`,
      );
      expect(response.status).toBe(400);
    });

    test("search results substitute too, per hit's own scope", async () => {
      await createEntry({ title: "Findable", body: "{{API_URL}}" });
      const response = await request(
        "GET",
        `${envBase}/collections/pages/search?q=Findable`,
      );
      expect(response.status).toBe(200);
      const hits = await response.json();
      expect(hits.data[0].entry.body).toBe("https://prod.example.com");
    });
  });

  describe("transfer", () => {
    test("an export carries declarations and values, so a restore still resolves", async () => {
      await declare("API_URL", "https://prod.example.com");

      const archive = await request("GET", "/api/export");
      expect(archive.status).toBe(200);

      const restoredDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-variables-restore-"));
      const restoredStore = await SqliteStore.open(path.join(restoredDir, "test.db"));
      try {
        const restored = new SiloService(restoredStore);
        const restoredApp = new SiloServer(restored, {
          version: "test",
          authDisabled: true,
          logger: Logger.silent(),
        }).build();

        const imported = await restoredApp.request("/api/import", {
          method: "POST",
          headers: { "Content-Type": "application/gzip" },
          body: await archive.arrayBuffer(),
        });
        expect(imported.status).toBeLessThan(300);

        const list = await (
          await restoredApp.request(`${envBase}/variables`)
        ).json();
        expect(list.items).toEqual([
          expect.objectContaining({ name: "API_URL", value: "https://prod.example.com" }),
        ]);
      } finally {
        await restoredStore.close();
        await fs.rm(restoredDir, { recursive: true, force: true });
      }
    });
  });

  describe("scope deletion takes its variables with it", () => {
    test("deleting an environment clears its values and keeps the declaration", async () => {
      await request("POST", `${base}/environments`, { id: "staging" });
      await declare("API_URL", "https://prod.example.com");
      await request("PUT", `${base}/environments/staging/variables/API_URL`, {
        value: "https://staging.example.com",
      });

      expect(
        (await (await request("GET", `${envBase}/variables`)).json()).items[0].set_in,
      ).toBe(2);

      expect(
        (await request("DELETE", `${base}/environments/staging?force=true`)).status,
      ).toBe(204);

      const list = await (await request("GET", `${envBase}/variables`)).json();
      expect(list.items[0]).toMatchObject({ name: "API_URL", set_in: 1 });
    });

    test("a recreated environment comes back unset rather than inheriting", async () => {
      await request("POST", `${base}/environments`, { id: "staging" });
      await declare("API_URL", "https://prod.example.com");
      await request("PUT", `${base}/environments/staging/variables/API_URL`, {
        value: "https://staging.example.com",
      });
      await request("DELETE", `${base}/environments/staging?force=true`);
      await request("POST", `${base}/environments`, { id: "staging" });

      const list = await (
        await request("GET", `${base}/environments/staging/variables`)
      ).json();
      expect(list.items[0]).toMatchObject({ name: "API_URL", value: null });
    });

    test("deleting a project forgets its declarations", async () => {
      await request("POST", "/api/projects", { id: "other" });
      await request("POST", `/api/projects/other/environments`, { id: "prod" });
      await request("POST", `/api/projects/other/variables?env=prod`, {
        name: "GONE",
        value: "x",
      });

      expect((await request("DELETE", "/api/projects/other?force=true")).status).toBe(204);

      // Recreated at the same name, and therefore a new record id: nothing the
      // old project declared may come back with it.
      await request("POST", "/api/projects", { id: "other" });
      await request("POST", `/api/projects/other/environments`, { id: "prod" });
      const list = await (
        await request("GET", "/api/projects/other/environments/prod/variables")
      ).json();
      expect(list.items).toEqual([]);
    });

    test("renaming an environment keeps its values, since they are keyed by id", async () => {
      await declare("API_URL", "https://prod.example.com");
      const renamed = await request("PATCH", `${base}/environments/${prod}`, {
        name: "production",
      });
      expect(renamed.status).toBe(200);

      const list = await (
        await request("GET", `${base}/environments/production/variables`)
      ).json();
      expect(list.items[0]).toMatchObject({
        name: "API_URL",
        value: "https://prod.example.com",
      });
    });
  });
});
