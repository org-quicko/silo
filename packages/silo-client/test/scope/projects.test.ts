import { describe, expect, test } from "bun:test";
import { Projects } from "../../src/scope/projects";
import { Transport } from "../../src/transport/transport";
import { StubFetch } from "../support/stub-fetch";
import { StubResponse } from "../support/stub-response";

describe("Projects", () => {
  test("list() GETs /api/projects and maps {id, name}", async () => {
    const stubFetch = new StubFetch();
    stubFetch.enqueue(StubResponse.json({ items: [{ id: "01J8", name: "acme" }] }));
    const projects = new Projects(new Transport({ url: "http://localhost:8090", fetch: stubFetch.fetch }));

    const list = await projects.list();

    expect(stubFetch.received[0].url).toBe("http://localhost:8090/api/projects");
    expect(list).toEqual([{ id: "01J8", name: "acme" }]);
  });

  test("create() POSTs {id: name}", async () => {
    const stubFetch = new StubFetch();
    stubFetch.enqueue(StubResponse.json({ id: "01J8", name: "acme" }, 201));
    const projects = new Projects(new Transport({ url: "http://localhost:8090", fetch: stubFetch.fetch }));

    const project = await projects.create("acme");

    expect(stubFetch.received[0].method).toBe("POST");
    expect(JSON.parse(stubFetch.received[0].body ?? "{}")).toEqual({ id: "acme" });
    expect(project).toEqual({ id: "01J8", name: "acme" });
  });
});
