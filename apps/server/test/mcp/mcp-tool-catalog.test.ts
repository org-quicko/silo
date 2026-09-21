import { describe, test, expect } from "bun:test";
import Ajv2020 from "ajv/dist/2020";
import { McpToolCatalog } from "../../src/mcp/mcp-tool-catalog";

/**
 * The catalog is the contract a client reads before it calls anything, so
 * each entry has to be well formed on its own: a unique name, a schema AJV
 * will compile, and a request that lands under `/api/`.
 */
describe("MCP tool catalog", () => {
  const catalog = McpToolCatalog.default();

  test("every tool has a unique name and a compilable input schema", () => {
    const ajv = new Ajv2020({ strict: false });
    const names = new Set<string>();
    for (const tool of catalog.all()) {
      expect(names.has(tool.name)).toBe(false);
      names.add(tool.name);
      expect(tool.name).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(tool.description.length).toBeGreaterThan(20);
      expect(() => ajv.compile(tool.inputSchema)).not.toThrow();
    }
    expect(names.size).toBeGreaterThanOrEqual(19);
  });

  test("descriptors carry what tools/list needs and never the request mapping", () => {
    for (const descriptor of catalog.descriptors()) {
      expect(Object.keys(descriptor).sort()).toEqual(
        ["annotations", "description", "inputSchema", "name", "title"].sort()
      );
      expect((descriptor.annotations as { title: string }).title).toBe(descriptor.title as string);
    }
  });

  test("read tools say so, write tools do not", () => {
    const readOnly = (name: string) => catalog.find(name)!.annotations.readOnlyHint;
    expect(readOnly("list_entries")).toBe(true);
    expect(readOnly("get_schema")).toBe(true);
    expect(readOnly("search")).toBe(true);
    expect(readOnly("create_entry")).toBe(false);
    expect(readOnly("delete_collection")).toBe(false);
    expect(catalog.find("delete_entry")!.annotations.destructiveHint).toBe(true);
  });

  test("scoped tools address the canonical /environments paths and encode segments", () => {
    const scope = { project: "acme", env: "prod", collection: "posts" };
    expect(catalog.find("list_entries")!.request(scope).path).toBe(
      "/api/projects/acme/environments/prod/collections/posts"
    );
    expect(catalog.find("get_entry")!.request({ ...scope, id: "01J8 X/Y" }).path).toBe(
      "/api/projects/acme/environments/prod/collections/posts/01J8%20X%2FY"
    );
    expect(catalog.find("delete_collection")!.request({ ...scope, force: true })).toEqual({
      method: "DELETE",
      path: "/api/projects/acme/environments/prod/collections/posts/schema",
      query: { force: "true" },
    });
  });

  test("list_entries serializes the filter AST and the page into the query", () => {
    const request = catalog.find("list_entries")!.request({
      project: "acme",
      env: "prod",
      collection: "posts",
      filter: { op: "eq", path: "$.data.status", value: "published" },
      sort: "-$.updated_at",
      limit: 5,
      offset: 10,
      raw_variables: true,
    });
    expect(request.query).toEqual({
      filter: '{"op":"eq","path":"$.data.status","value":"published"}',
      sort: "-$.updated_at",
      limit: "5",
      offset: "10",
      variables: "raw",
    });
  });

  test("search picks its reach from the arguments given", () => {
    const search = catalog.find("search")!;
    expect(search.request({ q: "x" }).path).toBe("/api/search");
    expect(search.request({ q: "x", project: "acme", env: "prod" }).path).toBe(
      "/api/projects/acme/environments/prod/search"
    );
    expect(search.request({ q: "x", project: "acme", env: "prod", collection: "posts" }).path).toBe(
      "/api/projects/acme/environments/prod/collections/posts/search"
    );
  });

  test("update_entry sends the rev as a query and the data as the body", () => {
    const request = catalog.find("update_entry")!.request({
      project: "acme",
      env: "prod",
      collection: "posts",
      id: "01J8",
      rev: 3,
      data: { title: "Hello" },
    });
    expect(request).toEqual({
      method: "PUT",
      path: "/api/projects/acme/environments/prod/collections/posts/01J8",
      query: { rev: "3" },
      body: { title: "Hello" },
    });
  });

  test("every request stays under /api/", () => {
    const sample = { project: "p", env: "e", collection: "c", id: "i", rev: 1, data: {}, schema: {}, q: "x" };
    for (const tool of catalog.all()) {
      expect(tool.request(sample).path.startsWith("/api/")).toBe(true);
    }
  });
});
