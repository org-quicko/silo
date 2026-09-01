import { describe, expect, test } from "bun:test";
import { SnapshotRoutes } from "../src/routes/snapshot-routes";

describe("the observability snapshot route", () => {
  test("uses the core endpoint and preserves its status and JSON", async () => {
    const calls: string[] = [];
    const handler = SnapshotRoutes.handlers()["GET /snapshot"]! as Function;
    const response = await handler({}, {
      fetch: async (path: string) => {
        calls.push(path);
        return {
          status: 200,
          json: () => ({ requests: { total: 7 } }),
        };
      },
    });

    expect(calls).toEqual(["/api/observability"]);
    expect(response).toEqual({ status: 200, json: { requests: { total: 7 } } });
  });

  test("does not turn an authorization refusal into a successful route", async () => {
    const handler = SnapshotRoutes.handlers()["GET /snapshot"]! as Function;
    const response = await handler({}, {
      fetch: async () => ({
        status: 403,
        json: () => ({ error: { code: "forbidden" } }),
      }),
    });
    expect(response.status).toBe(403);
    expect(response.json.error.code).toBe("forbidden");
  });
});
