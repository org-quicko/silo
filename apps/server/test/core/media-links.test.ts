import { describe, expect, test } from "bun:test";
import { MediaRef } from "@silo/shared/media-ref";
import { MediaLinks } from "../../src/core/media/media-links";
import type { MediaConfig } from "../../src/config/media-config";

const id = "01J8XQ4Z8K9M2P3R5T7V9X1B3D";
const origin = "http://localhost:8090";

const config = (patch: Partial<MediaConfig> = {}): MediaConfig => ({
  base_url_target: "server",
  extensions: ["*"],
  ...patch,
});

/**
 * Where a media reference resolves to (D46).
 *
 * Every case here is a way the page could hand out a link that does not work.
 * The two targets address an asset by different things — a catalog id that
 * silo serves, or a blob key that a bucket serves — so a URL built with the
 * wrong one is well-formed, plausible, and 404s.
 */
describe("MediaLinks", () => {
  test("with no configuration it is what every response did before", () => {
    const links = MediaLinks.fromRequest(origin);
    expect(links.urlFor(MediaRef.url(id))).toBe(`${origin}/media/${id}`);
    expect(links.needsKeys).toBe(false);
  });

  test("a base URL replaces the request's origin, not the path", () => {
    const links = MediaLinks.of(config({ base_url: "https://cms.example.com" }), origin);
    expect(links.urlFor(MediaRef.url(id))).toBe(`https://cms.example.com/media/${id}`);
  });

  test("a trailing slash on the base does not double up", () => {
    const links = MediaLinks.of(config({ base_url: "https://cms.example.com/" }), origin);
    expect(links.urlFor(MediaRef.url(id))).toBe(`https://cms.example.com/media/${id}`);
  });

  test("the store target addresses the blob key, which is what a bucket serves", () => {
    const links = MediaLinks.of(
      config({ base_url: "https://cdn.example.com", base_url_target: "store" }),
      origin,
      new Map([[id, `${id}.png`]])
    );
    expect(links.needsKeys).toBe(true);
    expect(links.urlFor(MediaRef.url(id))).toBe(`https://cdn.example.com/${id}.png`);
  });

  test("a store-mode asset with no key falls back to silo, never to the CDN", () => {
    // The CDN has never heard of /media/<id>. Rooting a path there would hand
    // back a link that 404s, so the one host known to serve it wins — D35's
    // judgement about a base that resolves nowhere.
    const links = MediaLinks.of(
      config({ base_url: "https://cdn.example.com", base_url_target: "store" }),
      origin
    );
    expect(links.urlFor(MediaRef.url(id))).toBe(`${origin}/media/${id}`);
  });

  test("a pre-D23 reference needs no lookup in store mode: it names the key", () => {
    const links = MediaLinks.of(
      config({ base_url: "https://cdn.example.com", base_url_target: "store" }),
      origin
    );
    expect(links.urlFor("/media/aabb_old.png")).toBe("https://cdn.example.com/aabb_old.png");
  });

  test("a foreign URL is somebody else's asset and is left alone", () => {
    const links = MediaLinks.of(config({ base_url: "https://cms.example.com" }), origin);
    expect(links.urlFor("http://cdn.com/media/x.png")).toBe("http://cdn.com/media/x.png");
  });

  test("a bare string is not guessed at as a media key", () => {
    expect(MediaLinks.fromRequest(origin).urlFor("hash_file.png")).toBe("hash_file.png");
  });

  test("a plugin request with no origin and no base leaves the reference alone", () => {
    // D35: rewriting into a hostname that resolves nowhere is worse than not
    // rewriting, and a dispatched request crossed no socket to learn one from.
    expect(MediaLinks.of(config(), "").urlFor(MediaRef.url(id))).toBe(MediaRef.url(id));
  });

  test("an asset URL with no base at all stays relative", () => {
    // What the media API answers with when nothing is configured: the admin
    // joins it to the server it is talking to, which it already knows.
    expect(MediaLinks.of(config(), "").forAsset(id, `${id}.png`)).toBe(`/media/${id}`);
  });
});
