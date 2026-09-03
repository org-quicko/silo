import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { gzipSync } from "zlib";
import { Header } from "tar";
import { PackageExtractor, PluginInstaller } from "../../src/plugins";

interface HostileEntry {
  path: string;
  type?: string;
  body?: string;
  linkpath?: string;
  mode?: number;
}

/**
 * Tar archives built by hand, entry by entry, so the ones no publishing tool
 * would ever produce can be tested.
 *
 * `tar.c` writes what is on disk and refuses to write an escape, which is
 * exactly why it is no use here: the archives that matter are the ones an
 * attacker wrote, not the ones a packer would.
 */
class HostileArchive {
  static async write(file: string, entries: readonly HostileEntry[]): Promise<string> {
    const blocks: Buffer[] = [];

    for (const entry of entries) {
      const body = Buffer.from(entry.body ?? "", "utf8");
      const header = new Header({
        path: entry.path,
        // A link or a directory carries no payload; a size on one is how some
        // extractors are confused into reading the next header as content.
        size: entry.type && entry.type !== "File" ? 0 : body.length,
        type: (entry.type ?? "File") as any,
        mode: entry.mode ?? 0o644,
        mtime: new Date(0),
        uid: 0,
        gid: 0,
        linkpath: entry.linkpath,
      });

      const block = Buffer.alloc(512);
      header.encode(block, 0);
      blocks.push(block);

      if ((header.size ?? 0) > 0) {
        const padded = Buffer.alloc(Math.ceil(body.length / 512) * 512);
        body.copy(padded);
        blocks.push(padded);
      }
    }

    blocks.push(Buffer.alloc(1024)); // the two zero blocks that end an archive
    await fs.writeFile(file, gzipSync(Buffer.concat(blocks)));
    return file;
  }
}

/**
 * What `silo add` refuses to unpack (D32/§13.8).
 *
 * §13.8's one stated requirement of any installer is that it reuse
 * `EntryUtils.assertSafeSegment` when extracting, and this is the suite that
 * pins it. The companion to `hostile-plugin.test.ts`: that one bounds a plugin
 * that is already running, this one bounds a package that is trying not to
 * become one — an archive that writes outside the directory it was given never
 * reaches the `Worker` those bounds apply to.
 *
 * Every case asserts two things, and the second is the one that would be easy
 * to lose: it is refused, **and nothing was written**. An extractor that
 * skipped bad entries would pass the first half while leaving a partial
 * package on disk and treating an attack as a package with some odd files in
 * it.
 */
describe("hostile archives", () => {
  let root: string;
  let into: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "silo-archive-test-"));
    into = path.join(root, "out");
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const archive = (entries: readonly HostileEntry[]) =>
    HostileArchive.write(path.join(root, "hostile.tgz"), entries);

  const extract = (file: string) => PackageExtractor.extract(file, into, "test archive");

  const wrote = async (): Promise<boolean> => {
    try {
      await fs.stat(into);
      return true;
    } catch {
      return false;
    }
  };

  const wellFormed: readonly HostileEntry[] = [
    { path: "package/package.json", body: `{"name":"x","version":"1.0.0"}` },
    { path: "package/index.ts", body: "export default {};\n" },
  ];

  test("the helper writes archives silo accepts, so a refusal below means something", async () => {
    await extract(await archive(wellFormed));
    expect(await fs.readFile(path.join(into, "package", "index.ts"), "utf8")).toBe(
      "export default {};\n"
    );
  });

  test("a path climbing out of the directory is refused, and nothing is written", async () => {
    const file = await archive([...wellFormed, { path: "package/../../escape.txt", body: "owned" }]);
    await expect(extract(file)).rejects.toThrow(/unsafe path/);
    expect(await wrote()).toBe(false);
  });

  test("a bare ../ entry is refused", async () => {
    const file = await archive([{ path: "../escape.txt", body: "owned" }]);
    await expect(extract(file)).rejects.toThrow(/unsafe path/);
    expect(await wrote()).toBe(false);
  });

  test("an absolute path is refused", async () => {
    const file = await archive([{ path: "/etc/cron.d/silo", body: "* * * * * root sh\n" }]);
    await expect(extract(file)).rejects.toThrow(/absolute path/);
    expect(await wrote()).toBe(false);
  });

  test("a symlink is refused — it is the entry that makes every later one escape", async () => {
    // `node_modules -> /` costs one entry, and every write after it lands
    // outside. Nothing legitimate in a published plugin needs one.
    const file = await archive([
      ...wellFormed,
      { path: "package/node_modules", type: "SymbolicLink", linkpath: "/" },
    ]);
    await expect(extract(file)).rejects.toThrow(/SymbolicLink/);
    expect(await wrote()).toBe(false);
  });

  test("a hard link is refused for the same reason", async () => {
    const file = await archive([
      ...wellFormed,
      { path: "package/passwd", type: "Link", linkpath: "/etc/passwd" },
    ]);
    await expect(extract(file)).rejects.toThrow(/Link/);
    expect(await wrote()).toBe(false);
  });

  test("a device node has no meaning in a package", async () => {
    const file = await archive([
      ...wellFormed,
      { path: "package/random", type: "CharacterDevice" },
    ]);
    await expect(extract(file)).rejects.toThrow(/CharacterDevice/);
    expect(await wrote()).toBe(false);
  });

  test("a setuid entry is refused — tar would carry the bit onto the created file", async () => {
    // The one weapon in an archive that needs no plugin to ever load: tar keeps
    // all twelve mode bits when it creates the file, and the umask masks only
    // the low nine, so this lands as a setuid file during *extraction* — before
    // the manifest is judged and before anyone is asked anything.
    const file = await archive([
      ...wellFormed,
      { path: "package/helper", body: "#!/bin/sh\nexec /bin/sh\n", mode: 0o4755 },
    ]);
    await expect(extract(file)).rejects.toThrow(/setuid\/setgid\/sticky/);
    expect(await wrote()).toBe(false);
  });

  test("a setgid entry is refused too", async () => {
    const file = await archive([...wellFormed, { path: "package/helper", body: "x", mode: 0o2755 }]);
    await expect(extract(file)).rejects.toThrow(/setuid\/setgid\/sticky/);
    expect(await wrote()).toBe(false);
  });

  test("a sticky directory is refused", async () => {
    const file = await archive([...wellFormed, { path: "package/tmp/", type: "Directory", mode: 0o1777 }]);
    await expect(extract(file)).rejects.toThrow(/setuid\/setgid\/sticky/);
    expect(await wrote()).toBe(false);
  });

  test("an ordinary executable is not refused — only the high bits are", async () => {
    // The check has to be about privilege, not about the executable bit: a
    // plugin shipping a build script at 0755 is entirely normal.
    const file = await archive([
      { path: "package/package.json", body: `{"name":"x","version":"1.0.0"}` },
      { path: "package/build.sh", body: "#!/bin/sh\n", mode: 0o755 },
    ]);
    await extract(file);
    expect(await fs.readFile(path.join(into, "package", "build.sh"), "utf8")).toBe("#!/bin/sh\n");
  });

  test("an empty archive is refused rather than installed as an empty plugin", async () => {
    await expect(extract(await archive([]))).rejects.toThrow(/empty/);
  });

  test("an archive with no package.json is not a package", async () => {
    const file = await archive([{ path: "package/readme.md", body: "# hi\n" }]);
    await extract(file);
    await expect(PackageExtractor.packageRoot(into, "test archive")).rejects.toThrow(
      /no package.json/
    );
  });

  test("a hostile archive installs nothing, and stages nothing", async () => {
    const pluginsDir = path.join(root, "data", "plugins");
    const file = await archive([{ path: "../escape.txt", body: "owned" }]);

    await expect(
      PluginInstaller.install({ pluginsDir, spec: file })
    ).rejects.toThrow(/unsafe path/);

    // The staging directory lives inside the plugins directory so the final
    // move is a rename; the cost is that it must be cleaned up on every path
    // out, including this one.
    expect(await fs.readdir(pluginsDir)).toEqual([]);
  });

  describe("assertSafePath", () => {
    test("accepts what a package actually contains", () => {
      for (const ok of ["package.json", "src/index.ts", "a/./b", "@acme/x", "dist/index.js"]) {
        expect(() => PackageExtractor.assertSafePath(ok, "test")).not.toThrow();
      }
    });

    test("refuses every shape of escape", () => {
      for (const bad of ["../x", "a/../../x", "/x", "C:/x", "C:\\x", "a\\..\\b"]) {
        expect(() => PackageExtractor.assertSafePath(bad, "test")).toThrow();
      }
    });
  });
});
