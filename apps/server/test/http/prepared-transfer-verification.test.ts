import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "fs/promises";
import path from "path";
import { c as pack, x as unpack } from "tar";
import { EntryUtils } from "../../src/core/domain/entry-utils";
import { TransferPair } from "./support/transfer-pair";

/** A response body as JSON, untyped: each assertion says what it holds. */
const read = async (response: { json(): Promise<unknown> } | Promise<{ json(): Promise<unknown> }>): Promise<any> =>
  (await response).json();

/**
 * A prepared transfer refuses a package that is not exactly what it asked for
 * (D109), and keeps nothing of it. Each case below is a real package from the
 * source, changed in one way and offered by a source of the test's own.
 */
describe("prepared transfer verification", () => {
  let pair: TransferPair;
  let original: string;

  beforeEach(async () => {
    pair = await TransferPair.open();
    await pair.seed();
    const response = await fetch(`${pair.sourceUrl}api/projects/acme/envs/dev/package`, {
      method: "POST",
      headers: { Authorization: `Bearer ${pair.sourceKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ collections: [{ name: "posts", entry_ids: [pair.seeded.picked] }] }),
    });
    expect(response.status).toBe(200);
    const archive = path.join(pair.tempDir, "original.tar.gz");
    await Bun.write(archive, await response.arrayBuffer());
    original = path.join(pair.tempDir, "original");
    await fs.mkdir(original);
    await unpack({ file: archive, cwd: original });
  });

  afterEach(async () => {
    await pair.close();
  });

  const posts = (root: string) => path.join(root, "projects", "acme", "dev", "content", "posts");
  const system = (root: string, ...rest: string[]) => path.join(root, "projects", "_system", "_system", ...rest);
  const editJson = async (file: string, edit: (document: any) => void) => {
    const document = JSON.parse(await fs.readFile(file, "utf8"));
    edit(document);
    await fs.writeFile(file, JSON.stringify(document));
  };

  /** The original package, changed by `change`, as a source would send it. */
  const offer = async (change: (root: string) => Promise<void>) => {
    const root = await fs.mkdtemp(path.join(pair.tempDir, "case-"));
    await fs.cp(original, root, { recursive: true });
    await change(root);
    const archive = `${root}.tar.gz`;
    await pack({ gzip: true, file: archive, cwd: root }, await fs.readdir(root));
    const bytes = await Bun.file(archive).arrayBuffer();
    return pair.serve(() => new Response(bytes, { headers: { "Content-Type": "application/gzip" } }));
  };

  const prepareFrom = (url: string) =>
    pair.prepare(
      pair.body({ source: { url, api_key: "key" }, selection: [{ collection: "posts", entry_ids: [pair.seeded.picked] }] })
    );

  test("takes the package as the source sent it", async () => {
    expect((await prepareFrom(await offer(async () => {}))).status).toBe(201);
  });

  const tampered: [string, (root: string) => Promise<void>, string][] = [
    [
      "an entry that was not asked for",
      async (root) => {
        const id = EntryUtils.newID();
        await editJson(path.join(posts(root), `${pair.seeded.picked}.json`), (entry) => (entry.id = id));
        await fs.rename(path.join(posts(root), `${pair.seeded.picked}.json`), path.join(posts(root), `${id}.json`));
      },
      "does not hold exactly the entries asked for",
    ],
    [
      "a collection that was not asked for",
      (root) => fs.writeFile(path.join(root, "projects", "acme", "dev", "schemas", "pages.schema.json"), "{}"),
      "pages.schema.json was not asked for",
    ],
    [
      "a system collection other than media",
      async (root) => {
        await fs.mkdir(system(root, "content", "_variables"), { recursive: true });
        await fs.writeFile(system(root, "content", "_variables", "API_URL.json"), "{}");
      },
      "_variables was not asked for",
    ],
    [
      "an asset no packaged entry uses",
      async (root) => {
        const row = (await fs.readdir(system(root, "content", "_media")))[0]!;
        const id = EntryUtils.newID();
        await fs.copyFile(system(root, "content", "_media", row), system(root, "content", "_media", `${id}.json`));
        await editJson(system(root, "content", "_media", `${id}.json`), (entry) => {
          entry.id = id;
          entry.data.blob_key = `media/${id}`;
        });
        await fs.copyFile(path.join(root, "media", row.slice(0, -5)), path.join(root, "media", id));
      },
      "is not used by any packaged entry",
    ],
    [
      "bytes that are not the asset's",
      // As long as the asset's own, so only the hash can tell.
      (root) => fs.writeFile(path.join(root, "media", pair.seeded.asset), "USED"),
      "is not the file",
    ],
    [
      "a link to a file outside the package",
      async (root) => {
        // A valid entry, so only the link itself is wrong.
        const outside = path.join(pair.tempDir, "outside.json");
        await fs.copyFile(path.join(posts(root), `${pair.seeded.picked}.json`), outside);
        await fs.rm(path.join(posts(root), `${pair.seeded.picked}.json`));
        await fs.symlink(outside, path.join(posts(root), `${pair.seeded.picked}.json`));
      },
      "is not a plain file or folder",
    ],
    [
      "a package version this server does not read",
      (root) => editJson(path.join(root, "package.json"), (manifest) => (manifest.package_version = 2)),
      "package_version 2",
    ],
    [
      "an export archive instead of a package",
      (root) => fs.rename(path.join(root, "package.json"), path.join(root, "manifest.json")),
      "has no package.json",
    ],
    [
      "a package.json that miscounts its media",
      (root) => editJson(path.join(root, "package.json"), (manifest) => (manifest.media_folders = 0)),
      "does not describe the media",
    ],
  ];

  for (const [name, change, problem] of tampered) {
    test(`refuses ${name} and keeps nothing`, async () => {
      const refused = await prepareFrom(await offer(change));
      expect(refused.status).toBe(400);
      expect((await read(refused)).error.message).toContain(problem);
      expect(await pair.transferDirectories()).toEqual([]);
    });
  }

  test("tells a source without the route apart from a source that refuses", async () => {
    const cases: [string, string, string][] = [
      [
        "an older silo",
        pair.serve(() => Response.json({ error: { code: "not_found", message: "not found" } }, { status: 404 })),
        "needs silo 1.6.0 or later",
      ],
      ["a web server", pair.serve(() => new Response("<html></html>", { headers: { "Content-Type": "text/html" } })), "needs silo 1.6.0 or later"],
      [
        "a server that sends something else as gzip",
        pair.serve(() => new Response("not a package", { headers: { "Content-Type": "application/gzip" } })),
        "did not send a transfer package",
      ],
    ];
    for (const [name, url, problem] of cases) {
      const refused = await prepareFrom(url);
      expect([name, refused.status, (await read(refused)).error.message]).toEqual([name, 400, expect.stringContaining(problem)]);
    }

    const missing = await pair.prepare(pair.body({ selection: [{ collection: "posts", entry_ids: [EntryUtils.newID()] }] }));
    expect((await read(missing)).error.message).toContain("the source refused the package (404): not in acme/dev");
    const unknownKey = await pair.prepare(pair.body({ source: { url: pair.sourceUrl, api_key: "silo_wrong" } }));
    expect((await read(unknownKey)).error.message).toContain("the source refused the key");
    expect(await pair.transferDirectories()).toEqual([]);
  });

  test("holds a package to the size limits an upload has", async () => {
    const limited = await TransferPair.open({ transfer: { max_archive_size_mb: 100, max_extracted_size_mb: 0.01 } });
    try {
      await limited.seed();
      const refused = await limited.prepare(limited.body());
      expect(refused.status).toBe(413);
      expect((await read(refused)).error.code).toBe("archive_too_large");
      expect(await limited.transferDirectories()).toEqual([]);
    } finally {
      await limited.close();
    }
  });
});
