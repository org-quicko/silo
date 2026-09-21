import { describe, expect, test } from "bun:test";
import { MediaFolders } from "../../src/media/media-folders";
import { Transport } from "../../src/transport/transport";
import { StubFetch } from "../support/stub-fetch";
import { StubResponse } from "../support/stub-response";

function setup() {
  const stubFetch = new StubFetch();
  const transport = new Transport({ url: "http://localhost:8090", fetch: stubFetch.fetch });
  return { stubFetch, folders: new MediaFolders(transport) };
}

describe("MediaFolders.list", () => {
  test("GET /api/media/folders, answering items", async () => {
    const { stubFetch, folders } = setup();
    stubFetch.enqueue(StubResponse.json({ items: ["heroes", "heroes/2026"] }));

    const result = await folders.list();

    expect(stubFetch.received[0].method).toBe("GET");
    expect(stubFetch.received[0].url).toBe("http://localhost:8090/api/media/folders");
    expect(result).toEqual(["heroes", "heroes/2026"]);
  });
});

describe("MediaFolders.create", () => {
  test("POST {path}, answering the path the server settled on", async () => {
    const { stubFetch, folders } = setup();
    stubFetch.enqueue(StubResponse.json({ path: "heroes/2026" }, 201));

    const result = await folders.create("heroes/2026");

    expect(stubFetch.received[0].method).toBe("POST");
    expect(stubFetch.received[0].url).toBe("http://localhost:8090/api/media/folders");
    expect(JSON.parse(stubFetch.received[0].body ?? "")).toEqual({ path: "heroes/2026" });
    expect(result).toBe("heroes/2026");
  });
});

describe("MediaFolders.rename", () => {
  test("PATCH {from, to, merge}", async () => {
    const { stubFetch, folders } = setup();
    stubFetch.enqueue(StubResponse.json({ from: "heroes", to: "banners" }));

    const result = await folders.rename("heroes", "banners", { merge: true });

    expect(stubFetch.received[0].method).toBe("PATCH");
    expect(JSON.parse(stubFetch.received[0].body ?? "")).toEqual({ from: "heroes", to: "banners", merge: true });
    expect(result).toEqual({ from: "heroes", to: "banners" });
  });

  test("merge defaults to false when omitted", async () => {
    const { stubFetch, folders } = setup();
    stubFetch.enqueue(StubResponse.json({ from: "heroes", to: "banners" }));

    await folders.rename("heroes", "banners");

    expect(JSON.parse(stubFetch.received[0].body ?? "")).toEqual({ from: "heroes", to: "banners", merge: false });
  });
});

describe("MediaFolders.delete", () => {
  test("carries the folder path as ?path=, url-encoding a slash", async () => {
    const { stubFetch, folders } = setup();
    stubFetch.enqueue(StubResponse.empty());

    await folders.delete("heroes/2026 spring");

    expect(stubFetch.received[0].method).toBe("DELETE");
    expect(stubFetch.received[0].url).toBe(
      "http://localhost:8090/api/media/folders?path=heroes%2F2026%20spring",
    );
  });

  test("recursive and force are only sent when true", async () => {
    const { stubFetch, folders } = setup();
    stubFetch.enqueue(StubResponse.empty());

    await folders.delete("banners", { recursive: true, force: true });

    expect(stubFetch.received[0].url).toBe(
      "http://localhost:8090/api/media/folders?path=banners&recursive=true&force=true",
    );
  });

  test("omits recursive/force entirely when not requested", async () => {
    const { stubFetch, folders } = setup();
    stubFetch.enqueue(StubResponse.empty());

    await folders.delete("empty-folder");

    expect(stubFetch.received[0].url).toBe("http://localhost:8090/api/media/folders?path=empty-folder");
  });
});
