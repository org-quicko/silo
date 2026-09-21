import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { Hono } from "hono";
import { SqliteStore } from "../../src/adapters/storage/sqlite/sqlite-store";
import { SiloService } from "../../src/core/services/silo-service";
import { SiloServer } from "../../src/http/server";
import { Logger } from "../../src/logging/logger";
import { MediaDefaults } from "../../src/config/media-defaults";
import { MediaDisposition } from "../../src/core/media/media-disposition";
import { ResponseSandbox } from "../../src/http/response-sandbox";

/**
 * What an upload leaves the server as (D83). The 2026-09-18 audit's H1: an
 * SVG with a `<script>` uploaded by a `write`-preset key was served inline
 * from the origin the admin lives on, and one click on "Open" ran it with
 * every saved API key in reach. Every `/media/{id}` answer now carries
 * `nosniff` and a `sandbox` policy, an SVG and anything not image, video,
 * audio or PDF is an attachment, the content type is read off the extension
 * and never off what the upload declared, and `svg` is out of the default list.
 */
describe("media responses cannot become a page on silo's origin", () => {
  let tempDir: string;
  let store: SqliteStore;
  let service: SiloService;
  let app: Hono;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-media-headers-"));
    store = await SqliteStore.open(path.join(tempDir, "test.db"));
    service = new SiloService(store, { mediaDir: path.join(tempDir, "media") });
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

  const fetchMedia = async (id: string) => app.request(`/media/${id}`);

  test("every answer carries nosniff and a sandbox policy", async () => {
    const asset = await service.media.save("hero.png", new Uint8Array([1, 2, 3]));
    const response = await fetchMedia(asset.id);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toBe(ResponseSandbox.MediaPolicy);

    // The 304 leaves the same way: a cached document is still a document.
    const cached = await app.request(`/media/${asset.id}`, {
      headers: { "if-none-match": `"${asset.hash}"` },
    });
    expect(cached.status).toBe(304);
    expect(cached.headers.get("content-security-policy")).toBe(ResponseSandbox.MediaPolicy);
  });

  test("an SVG is an attachment, still typed as an image so an <img> draws it", async () => {
    const asset = await service.media.save("logo.svg", new TextEncoder().encode(svg));
    const response = await fetchMedia(asset.id);
    expect(response.headers.get("content-type")).toBe("image/svg+xml");
    expect(response.headers.get("content-disposition")).toBe(
      "attachment; filename*=UTF-8''logo.svg"
    );
  });

  test("images, video, audio and PDF stay inline", async () => {
    for (const name of ["a.png", "b.mp4", "c.mp3", "d.pdf"]) {
      const asset = await service.media.save(name, new Uint8Array([1]));
      const response = await fetchMedia(asset.id);
      expect(response.headers.get("content-disposition")).toBe(
        `inline; filename*=UTF-8''${name}`
      );
    }
  });

  test("the content type comes from the extension, never from what the upload declared", async () => {
    const form = new FormData();
    form.set("file", new File([svg], "page.html", { type: "image/png" }));
    const uploaded = await app.request("/api/media", { method: "POST", body: form });
    expect(uploaded.status).toBe(201);
    const asset = (await uploaded.json()) as { id: string; content_type: string };
    expect(asset.content_type).toBe("text/html; charset=utf-8");

    // And a type nothing in the library renders is downloaded, not shown.
    const response = await fetchMedia(asset.id);
    expect(response.headers.get("content-disposition")).toStartWith("attachment;");
  });

  test("svg is not in the default allowlist, and the disposition rule is stated once", () => {
    expect(MediaDefaults.Extensions).not.toContain("svg");
    expect(MediaDefaults.Extensions).toContain("png");

    expect(MediaDisposition.of("image/svg+xml")).toBe("attachment");
    expect(MediaDisposition.of("image/png")).toBe("inline");
    expect(MediaDisposition.of("video/quicktime")).toBe("inline");
    expect(MediaDisposition.of("application/pdf")).toBe("inline");
    expect(MediaDisposition.of("text/html; charset=utf-8")).toBe("attachment");
    expect(MediaDisposition.of("application/octet-stream")).toBe("attachment");
  });

  test("a caller's own spelling of either header does not survive beside silo's", () => {
    const headers = ResponseSandbox.apply(
      { "content-security-policy": "default-src *", "X-CONTENT-TYPE-OPTIONS": "none", "X-Trace": "kept" },
      ResponseSandbox.ApiPolicy
    );
    expect(headers).toEqual({
      "X-Trace": "kept",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": ResponseSandbox.ApiPolicy,
    });
  });
});
