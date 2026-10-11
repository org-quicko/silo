import { describe, expect, test } from "bun:test";
import { Media } from "../../src/media/media";
import type { FetchFunction } from "../../src/transport/fetch-function";
import { Transport } from "../../src/transport/transport";
import { StubFetch } from "../support/stub-fetch";
import { StubResponse } from "../support/stub-response";

function setup() {
  const stubFetch = new StubFetch();
  const transport = new Transport({ url: "http://localhost:8090", fetch: stubFetch.fetch });
  return { stubFetch, media: new Media(transport) };
}

/** A fetch that records the raw `RequestInit` it was called with, so a
 *  multipart body (a `FormData`, not a string) can be inspected — `StubFetch`
 *  only records string bodies. */
function capturingFetch(payload: unknown, status = 201): { fetch: FetchFunction; requests: RequestInit[] } {
  const requests: RequestInit[] = [];
  const fetch: FetchFunction = async (_input, init) => {
    requests.push(init ?? {});
    return StubResponse.json(payload, status);
  };
  return { fetch, requests };
}

const assetPayload = (overrides: Record<string, unknown> = {}) => ({
  id: "01UPLOAD",
  filename: "hero.png",
  folder: "heroes",
  blob_key: "01UPLOAD.hero.png",
  size: 3,
  content_type: "image/png",
  hash: "abc",
  state: "active",
  tags: [],
  url: "http://localhost:8090/media/01UPLOAD",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  usage_count: 0,
  ...overrides,
});

describe("Media.upload: the bytes form", () => {
  test("sends multipart with a file part and the folder, and sets no Content-Type", async () => {
    const { fetch, requests } = capturingFetch(assetPayload());
    const media = new Media(new Transport({ url: "http://localhost:8090", fetch }));

    const asset = await media.upload({
      bytes: new Uint8Array([1, 2, 3]),
      filename: "hero.png",
      contentType: "image/png",
      folder: "heroes",
    });

    expect(requests[0].method).toBe("POST");
    expect(new Headers(requests[0].headers).get("content-type")).toBeNull();
    const form = requests[0].body as FormData;
    const file = form.get("file") as File;
    expect(file.name).toBe("hero.png");
    expect(file.type).toBe("image/png");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(form.get("folder")).toBe("heroes");
    expect(asset.id).toBe("01UPLOAD");
  });
});

describe("Media.upload: a File", () => {
  test("carries its own name; folder comes from the second argument", async () => {
    const { fetch, requests } = capturingFetch(assetPayload());
    const media = new Media(new Transport({ url: "http://localhost:8090", fetch }));
    const file = new File(["bytes"], "photo.jpg", { type: "image/jpeg" });

    await media.upload(file, { folder: "heroes" });

    const form = requests[0].body as FormData;
    const uploaded = form.get("file") as File;
    expect(uploaded.name).toBe("photo.jpg");
    expect(form.get("folder")).toBe("heroes");
  });
});

describe("Media.upload: a bare Blob", () => {
  test("uses the filename given explicitly", async () => {
    const { fetch, requests } = capturingFetch(assetPayload());
    const media = new Media(new Transport({ url: "http://localhost:8090", fetch }));
    const blob = new Blob(["bytes"], { type: "image/png" });

    await media.upload(blob, { filename: "hero.png" });

    const form = requests[0].body as FormData;
    const uploaded = form.get("file") as File;
    expect(uploaded.name).toBe("hero.png");
  });

  test("refuses with a clear message when no filename can be read off the input", async () => {
    const { fetch, requests } = capturingFetch(assetPayload());
    const media = new Media(new Transport({ url: "http://localhost:8090", fetch }));
    const blob = new Blob(["bytes"], { type: "image/png" });

    await expect(media.upload(blob)).rejects.toThrow(/filename/);
    expect(requests.length).toBe(0); // refused locally, before any request
  });
});

describe("Media.list", () => {
  test("translates the client query onto the wire's names", async () => {
    const { stubFetch, media } = setup();
    stubFetch.enqueue(StubResponse.json({ items: [], total: 0, limit: 50, offset: 0 }));

    await media.list({
      text: "hero",
      folder: "heroes",
      recursive: true,
      extension: "png",
      tag: "banner",
      modifiedAfter: "2026-01-01",
      modifiedBefore: "2026-09-01",
      sort: "-updated_at",
    });

    const url = new URL(stubFetch.received[0].url);
    expect(url.pathname).toBe("/api/media");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: "hero",
      folder: "heroes",
      recursive: "true",
      ext: "png",
      tag: "banner",
      modified_after: "2026-01-01",
      modified_before: "2026-09-01",
      sort: "-updated_at",
      limit: "50",
      offset: "0",
    });
  });
});

describe("Media.all", () => {
  test("stops after the first short page", async () => {
    const { stubFetch, media } = setup();
    stubFetch.enqueue(
      StubResponse.json({ items: [assetPayload({ id: "a" }), assetPayload({ id: "b" })], total: 2, limit: 50, offset: 0 }),
    );

    const ids: string[] = [];
    for await (const asset of media.all({ folder: "heroes" })) ids.push(asset.id);

    expect(ids).toEqual(["a", "b"]);
    expect(stubFetch.received.length).toBe(1);
  });
});

describe("Media.get", () => {
  test("GET /api/media/{id}, encoding an id with a slash", async () => {
    const { stubFetch, media } = setup();
    stubFetch.enqueue(StubResponse.json(assetPayload({ id: "a/b" })));

    const asset = await media.get("a/b");

    expect(stubFetch.received[0].url).toBe("http://localhost:8090/api/media/a%2Fb");
    expect(asset.id).toBe("a/b");
  });
});

describe("Media.extensions", () => {
  test("GET /api/media/extensions, answering items", async () => {
    const { stubFetch, media } = setup();
    stubFetch.enqueue(StubResponse.json({ items: ["png", "jpg"] }));

    const result = await media.extensions();

    expect(stubFetch.received[0].url).toBe("http://localhost:8090/api/media/extensions");
    expect(result).toEqual(["png", "jpg"]);
  });
});

describe("Media.deleteMany", () => {
  test("refuses more than 100 ids locally, without making a request", async () => {
    const { stubFetch, media } = setup();
    const ids = Array.from({ length: 101 }, (_, index) => `id-${index}`);

    await expect(media.deleteMany(ids)).rejects.toThrow(/100/);
    expect(stubFetch.received.length).toBe(0);
  });

  test("sends {ids, force} and reports deleted/failed from the 200 body", async () => {
    const { stubFetch, media } = setup();
    stubFetch.enqueue(
      StubResponse.json(
        {
          deleted: ["a"],
          failed: [
            {
              id: "b",
              code: "media_in_use",
              message: "in use",
              usage_count: 2,
              visible_count: 1,
              visible_capped: false,
              referrers: [{ media_id: "b", project: "acme", env: "prod", collection: "posts", entry_id: "01K1" }],
            },
            { id: "c", code: "not_found", message: "gone" },
          ],
        },
        200,
      ),
    );

    const report = await media.deleteMany(["a", "b", "c"], { force: true });

    expect(stubFetch.received[0].method).toBe("POST");
    expect(stubFetch.received[0].url).toBe("http://localhost:8090/api/media/delete");
    expect(JSON.parse(stubFetch.received[0].body ?? "")).toEqual({ ids: ["a", "b", "c"], force: true });
    expect(report.deleted).toEqual(["a"]);
    expect(report.failed).toEqual([
      {
        id: "b",
        code: "media_in_use",
        message: "in use",
        usageCount: 2,
        visibleCount: 1,
        visibleCapped: false,
        referrers: [{ mediaId: "b", project: "acme", environment: "prod", collection: "posts", entryId: "01K1" }],
      },
      { id: "c", code: "not_found", message: "gone" },
    ]);
  });
});
