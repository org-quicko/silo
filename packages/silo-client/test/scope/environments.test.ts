import { describe, expect, test } from "bun:test";
import { Environments } from "../../src/scope/environments";
import { Transport } from "../../src/transport/transport";
import { StubFetch } from "../support/stub-fetch";
import { StubResponse } from "../support/stub-response";

describe("Environments", () => {
  test("list() GETs the project's environments and maps {id, name}, dropping project_id", async () => {
    const stubFetch = new StubFetch();
    stubFetch.enqueue(StubResponse.json({ items: [{ id: "01J9", name: "staging", project_id: "01J8" }] }));
    const environments = new Environments(new Transport({ url: "http://localhost:8090", fetch: stubFetch.fetch }), "acme");

    const list = await environments.list();

    expect(stubFetch.received[0].url).toBe("http://localhost:8090/api/projects/acme/envs");
    expect(list).toEqual([{ id: "01J9", name: "staging" }]);
  });

  test("create() POSTs {id: name}", async () => {
    const stubFetch = new StubFetch();
    stubFetch.enqueue(StubResponse.json({ id: "01J9", name: "staging", project_id: "01J8" }, 201));
    const environments = new Environments(new Transport({ url: "http://localhost:8090", fetch: stubFetch.fetch }), "acme");

    const environment = await environments.create("staging");

    expect(JSON.parse(stubFetch.received[0].body ?? "{}")).toEqual({ id: "staging" });
    expect(environment).toEqual({ id: "01J9", name: "staging" });
  });
});
