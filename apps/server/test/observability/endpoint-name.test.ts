import { describe, expect, test } from "bun:test";
import { EndpointName } from "../../src/observability/endpoint-name";

/** How a request is filed in the metrics (D99): names for scopes, never ids. */
describe("EndpointName", () => {
  const entry = "/api/projects/:project/environments/:env/collections/:name/:id";
  const params = { project: "acme", env: "prod", name: "posts", id: "01JABCDEFGHJKMNPQRSTVWXYZ0" };

  test("a successful request is filed with its project, environment and collection, and the id left as :id", () => {
    expect(EndpointName.of(entry, params, 200)).toEqual({
      route: "/api/projects/acme/environments/prod/collections/posts/:id",
      pattern: entry,
      scope: { project: "acme", env: "prod", collection: "posts" },
    });
  });

  test("a project-level route names only the project", () => {
    const filed = EndpointName.of("/api/projects/:project/environments", { project: "acme" }, 200);
    expect(filed.route).toBe("/api/projects/acme/environments");
    expect(filed.scope).toEqual({ project: "acme" });
  });

  test("a failed request keeps the pattern, so made-up names never take a series", () => {
    for (const status of [400, 403, 404, 500]) {
      expect(EndpointName.of(entry, { ...params, project: "made-up" }, status)).toEqual({
        route: entry,
        pattern: entry,
      });
    }
  });

  test("an unmatched path is the catch-all, whatever was requested", () => {
    expect(EndpointName.of("/*", {}, 404).route).toBe("/api/*");
    expect(EndpointName.of("", {}, 200).route).toBe("/api/*");
  });

  test(":name outside collections/ is a plugin, and stays a parameter", () => {
    expect(EndpointName.of("/api/plugins/:name", { name: "acme" }, 200)).toEqual({
      route: "/api/plugins/:name",
      pattern: "/api/plugins/:name",
    });
  });

  test("a route with no scope parameter is its pattern", () => {
    expect(EndpointName.of("/api/media/:id", { id: "01JABC" }, 200).route).toBe("/api/media/:id");
  });
});
