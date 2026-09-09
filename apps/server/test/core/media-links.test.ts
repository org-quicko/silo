import { describe, expect, test } from "bun:test";
import { MediaRef } from "@silo/shared/media-ref";
import { MediaLinks } from "../../src/core/media/media-links";
import type { MediaConfig } from "../../src/config/media-config";

const id = "01J8XQ4Z8K9M2P3R5T7V9X1B3D";
const origin = "http://localhost:8090";
const bucket = "https://s3.ap-south-1.amazonaws.com/silo-media";

const config = (patch: Partial<MediaConfig> = {}): MediaConfig => ({
  extensions: ["*"],
  ...patch,
});

/**
 * Where a media reference resolves to (D46, D58).
 *
 * Every case here is a way a response could hand out a link that does not
 * work. The two shapes address an asset by different things — a catalog id
 * that silo serves, or a blob key that a bucket serves — so a URL built with
 * the wrong one is well-formed, plausible, and 404s. Which shape applies is
 * the store's answer and never a setting, which is D58: the pair of them could
 * disagree, and did.
 */
describe("MediaLinks", () => {
  test("with no configuration it is what every response did before", () => {
    const links = MediaLinks.fromRequest(origin);
    expect(links.urlFor(MediaRef.url(id))).toBe(`${origin}/media/${id}`);
  });

  // ---- silo serves the bytes ----

  test("no bucket and no base: the request's own origin, by catalog id", () => {
    const links = MediaLinks.of(config(), "", origin);
    expect(links.urlFor(MediaRef.url(id))).toBe(`${origin}/media/${id}`);
  });

  test("a base URL replaces the request's origin, not the path", () => {
    const links = MediaLinks.of(config({ base_url: "https://cms.example.com" }), "", origin);
    expect(links.urlFor(MediaRef.url(id))).toBe(`https://cms.example.com/media/${id}`);
  });

  test("a trailing slash on the base does not double up", () => {
    const links = MediaLinks.of(config({ base_url: "https://cms.example.com/" }), "", origin);
    expect(links.urlFor(MediaRef.url(id))).toBe(`https://cms.example.com/media/${id}`);
  });

  // ---- the bucket serves the bytes ----

  test("a bucket addresses the blob key, with no configuration at all", () => {
    // D58: the store decides the shape. An operator who moved the library to a
    // bucket did not also have to say that its URLs changed.
    const links = MediaLinks.of(config(), bucket, origin, new Map([[id, `${id}.png`]]));
    expect(links.urlFor(MediaRef.url(id))).toBe(`${bucket}/${id}.png`);
  });

  test("a base URL over a bucket swaps the host and keeps the key", () => {
    const links = MediaLinks.of(
      config({ base_url: "https://cdn.example.com" }),
      bucket,
      origin,
      new Map([[id, `${id}.png`]])
    );
    expect(links.urlFor(MediaRef.url(id))).toBe(`https://cdn.example.com/${id}.png`);
  });

  test("a bucket-backed asset with no key falls back to silo, never to the CDN", () => {
    // The CDN has never heard of /media/<id>. Rooting a path there would hand
    // back a link that 404s, so the one host known to serve it wins — D35's
    // judgement about a base that resolves nowhere.
    const links = MediaLinks.of(config({ base_url: "https://cdn.example.com" }), bucket, origin);
    expect(links.urlFor(MediaRef.url(id))).toBe(`${origin}/media/${id}`);
  });

  test("a pre-D23 reference needs no lookup on a bucket: it names the key", () => {
    const links = MediaLinks.of(config({ base_url: "https://cdn.example.com" }), bucket, origin);
    expect(links.urlFor("/media/aabb_old.png")).toBe("https://cdn.example.com/aabb_old.png");
  });

  test("the library's own listing gets the bucket URL, not a relative path", () => {
    // The point of D58. `forAsset` is what `MediaCatalog.toView` calls, and it
    // used to answer `/media/<id>` while the collections API answered a bucket
    // URL for the very same asset.
    expect(MediaLinks.of(config(), bucket, "").forAsset(id, `${id}.png`)).toBe(
      `${bucket}/${id}.png`
    );
  });

  // ---- values that are not references ----

  test("a foreign URL is somebody else's asset and is left alone", () => {
    const links = MediaLinks.of(config({ base_url: "https://cms.example.com" }), "", origin);
    expect(links.urlFor("http://cdn.com/media/x.png")).toBe("http://cdn.com/media/x.png");
  });

  test("a bare string is not guessed at as a media key", () => {
    expect(MediaLinks.fromRequest(origin).urlFor("hash_file.png")).toBe("hash_file.png");
  });

  test("a plugin request with no origin, no base and no bucket leaves the reference alone", () => {
    // D35: rewriting into a hostname that resolves nowhere is worse than not
    // rewriting, and a dispatched request crossed no socket to learn one from.
    expect(MediaLinks.of(config(), "", "").urlFor(MediaRef.url(id))).toBe(MediaRef.url(id));
  });

  test("an asset URL with no base and no bucket stays relative", () => {
    // What the media API answers with when nothing is configured: the admin
    // joins it to the server it is talking to, which it already knows.
    expect(MediaLinks.of(config(), "", "").forAsset(id, `${id}.png`)).toBe(`/media/${id}`);
  });

  // ---- D48: three states, not two ----

  test("asked and absent resolves to null", () => {
    const links = MediaLinks.of(config(), "", origin, new Map(), new Set([id]));
    expect(links.urlFor(MediaRef.url(id))).toBeNull();
  });

  test("asked and present resolves to a URL, exactly as before", () => {
    const links = MediaLinks.of(config(), "", origin, new Map([[id, `${id}.png`]]), new Set([id]));
    expect(links.urlFor(MediaRef.url(id))).toBe(`${origin}/media/${id}`);
  });

  test("never asked (no asked set at all) resolves to a URL — the id is not judged absent just because keys is empty", () => {
    const links = MediaLinks.of(config(), "", origin);
    expect(links.urlFor(MediaRef.url(id))).toBe(`${origin}/media/${id}`);
  });

  test("fromRequest never asks, so nothing it resolves is ever null", () => {
    expect(MediaLinks.fromRequest(origin).urlFor(MediaRef.url(id))).toBe(`${origin}/media/${id}`);
  });

  test("a legacy reference is never looked up and so is never null, even when the id is in `asked`", () => {
    const links = MediaLinks.of(config(), "", origin, new Map(), new Set(["aabb_old.png"]));
    expect(links.urlFor("/media/aabb_old.png")).toBe(`${origin}/media/aabb_old.png`);
  });
});
