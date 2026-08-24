import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { c } from "tar";
import { Integrity, ManifestReader, PluginInstaller, PluginLock } from "../../plugins";

/**
 * `silo add` from the sources that need no network (D32).
 *
 * The property every test here is really asserting is the one that let an
 * installer land on a frozen contract: what it leaves on disk is
 * indistinguishable from a directory someone copied in by hand, so
 * `ManifestReader` — the thing `serve` actually calls — is used as the oracle
 * rather than a bespoke assertion about the layout.
 *
 * The other half is what it leaves on disk when it *refuses*, which is
 * nothing. A half-installed plugin is the failure worth the most effort to
 * avoid: it is exactly the instance that starts, looks healthy, and has
 * quietly stopped enforcing something.
 */
describe("PluginInstaller", () => {
  let root: string;
  let pluginsDir: string;
  let sourceDir: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "silo-add-test-"));
    pluginsDir = path.join(root, "data", "plugins");
    sourceDir = path.join(root, "src");
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true }).catch(() => {});
  });

  const manifest = (overrides: { name?: string; silo?: Record<string, any> } = {}) => ({
    name: overrides.name ?? "silo-plugin-slug",
    version: "1.0.0",
    type: "module",
    main: "index.ts",
    silo: {
      silo: "*",
      kind: "extension",
      hooks: ["entry.beforeValidate"],
      claims: [],
      ...overrides.silo,
    },
  });

  /** A plugin package on disk, as `create-silo-plugin` would have written it. */
  const writePackage = async (dir: string, pkg: any, entry = true): Promise<string> => {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "package.json"), JSON.stringify(pkg, null, 2), "utf8");
    if (entry) {
      await fs.writeFile(path.join(dir, "index.ts"), `export default { hooks: {} };\n`, "utf8");
    }
    return dir;
  };

  const install = (spec: string, options: Record<string, any> = {}) =>
    PluginInstaller.install({ pluginsDir, spec, ...options });

  const entries = async (dir: string): Promise<string[]> => {
    try {
      return (await fs.readdir(dir)).sort();
    } catch {
      return [];
    }
  };

  describe("from a directory", () => {
    test("lands where the loader looks for it, and resolves there", async () => {
      await writePackage(sourceDir, manifest());
      const result = await install(sourceDir);

      expect(result.name).toBe("silo-plugin-slug");
      expect(result.dir).toBe(path.join(pluginsDir, "silo-plugin-slug"));

      // The oracle: the call `serve` makes, against the directory `add` wrote.
      const resolved = await ManifestReader.read(pluginsDir, "silo-plugin-slug");
      expect(resolved.manifest.hooks).toEqual(["entry.beforeValidate"]);
      expect(resolved.entry).toBe(path.join(result.dir, "index.ts"));
    });

    test("a scoped name lands under its scope, which is the resolution rule §13.3 froze", async () => {
      await writePackage(sourceDir, manifest({ name: "@acme/silo-plugin-slug" }));
      const result = await install(sourceDir);

      expect(result.dir).toBe(path.join(pluginsDir, "@acme", "silo-plugin-slug"));
      expect((await ManifestReader.read(pluginsDir, "@acme/silo-plugin-slug")).manifest.name).toBe(
        "@acme/silo-plugin-slug"
      );
    });

    test("the history that produced the source is not part of the plugin", async () => {
      await writePackage(sourceDir, manifest());
      await fs.mkdir(path.join(sourceDir, ".git"), { recursive: true });
      await fs.writeFile(path.join(sourceDir, ".git", "config"), "[core]\n", "utf8");

      const result = await install(sourceDir);
      expect(await entries(result.dir)).toEqual(["index.ts", "package.json"]);
    });

    test("the package's own name decides the directory, not the path it came from", async () => {
      await writePackage(path.join(root, "some-checkout"), manifest({ name: "silo-plugin-other" }));
      const result = await install(path.join(root, "some-checkout"));
      expect(result.dir).toBe(path.join(pluginsDir, "silo-plugin-other"));
    });
  });

  describe("from a tarball", () => {
    /** An npm-shaped tarball: one `package/` root, which is what
     *  `PackageExtractor.packageRoot` has to see through. */
    const pack = async (pkg: any): Promise<string> => {
      await writePackage(path.join(sourceDir, "package"), pkg);
      const file = path.join(root, "plugin.tgz");
      await c({ file, cwd: sourceDir, gzip: true }, ["package"]);
      return file;
    };

    test("unwraps the package/ root and installs what is inside it", async () => {
      const result = await install(await pack(manifest()));

      expect(result.dir).toBe(path.join(pluginsDir, "silo-plugin-slug"));
      expect(await entries(result.dir)).toEqual(["index.ts", "package.json"]);
      expect((await ManifestReader.read(pluginsDir, "silo-plugin-slug")).manifest.kind).toBe(
        "extension"
      );
    });

    test("records a digest even when nothing was given to check it against", async () => {
      // Computed, not verified — which is the whole distinction the lockfile
      // exists to preserve: the *second* install of the same file is checked.
      const result = await install(await pack(manifest()));
      expect(result.integrity).toMatch(/^sha512-[A-Za-z0-9+/]+=*$/);
    });

    test("--integrity is checked against the file, not quietly ignored", async () => {
      const file = await pack(manifest());
      const digest = Integrity.compute(await fs.readFile(file));

      // Honoured: the operator downloaded a release by hand and has the
      // publisher's digest from somewhere else.
      expect((await install(file, { integrity: digest })).name).toBe("silo-plugin-slug");
    });

    test("a --integrity that does not match refuses, and unpacks nothing", async () => {
      const file = await pack(manifest());
      const wrong = Integrity.compute(new TextEncoder().encode("some other tarball"));

      await expect(install(file, { integrity: wrong })).rejects.toThrow(/integrity check failed/);
      expect(await entries(pluginsDir)).toEqual([]);
    });
  });

  /**
   * A supplied digest has to be used or say why not.
   *
   * `--integrity` used to be accepted and silently dropped for every source but
   * `url`, which is the worst handling available for a security flag: the
   * operator types the argument that means "check this", the install proceeds
   * unchecked, and nothing in the output tells the two apart.
   */
  describe("--integrity applicability", () => {
    test("is refused for a directory, which transfers nothing to hash", async () => {
      await writePackage(sourceDir, manifest());
      await expect(install(sourceDir, { integrity: "sha512-x" })).rejects.toThrow(
        /does not apply to a directory source/
      );
    });

    test("is refused for git, which is pinned by commit instead", async () => {
      await expect(
        install("https://github.com/acme/silo-plugin-slug", { integrity: "sha512-x" })
      ).rejects.toThrow(/does not apply to a git source/);
    });

    test("a malformed digest fails before any network or disk work", async () => {
      // No package is written and no host is contacted: the shape is judged
      // first, so a typo costs a millisecond rather than a download.
      await expect(
        install("silo-plugin-slug@^1", { integrity: "deadbeef" })
      ).rejects.toThrow(/is not a digest/);
      expect(await entries(pluginsDir)).toEqual([]);
    });
  });

  describe("refusals", () => {
    test("a package with no silo block is not a plugin", async () => {
      await writePackage(sourceDir, { name: "silo-plugin-slug", version: "1.0.0" });
      await expect(install(sourceDir)).rejects.toThrow(/has no "silo" block/);
      expect(await entries(pluginsDir)).toEqual([]);
    });

    test("a range that excludes this binary is refused now, not at the next start", async () => {
      await writePackage(sourceDir, manifest({ silo: { silo: "^99" } }));
      await expect(install(sourceDir)).rejects.toThrow(/needs silo \^99/);
      expect(await entries(pluginsDir)).toEqual([]);
    });

    test("a provider cannot take a reserved driver name", async () => {
      await writePackage(
        sourceDir,
        manifest({ silo: { kind: "provider", hooks: [], provider: { port: "storage", driver: "sqlite" } } })
      );
      await expect(install(sourceDir)).rejects.toThrow(/reserved for a built-in adapter/);
      expect(await entries(pluginsDir)).toEqual([]);
    });

    test("a missing entry module is caught after the move, and rolled back", async () => {
      // Nothing static can see this: the manifest is well formed and names a
      // file that is not there. It fails on the same `ManifestReader.read`
      // `serve` would fail on — with the directory taken away again.
      await writePackage(sourceDir, manifest(), false);
      await expect(install(sourceDir)).rejects.toThrow(/no entry module/);
      expect(await entries(pluginsDir)).toEqual([]);
    });

    test("a rolled-back scoped install leaves no empty scope directory", async () => {
      await writePackage(sourceDir, manifest({ name: "@acme/silo-plugin-slug" }), false);
      await expect(install(sourceDir)).rejects.toThrow(/no entry module/);
      expect(await entries(pluginsDir)).toEqual([]);
    });

    test("installing over an existing plugin needs --force", async () => {
      await writePackage(sourceDir, manifest());
      await install(sourceDir);
      await expect(install(sourceDir)).rejects.toThrow(/already installed/);
    });

    test("--force replaces it, and does not merge into what was there", async () => {
      await writePackage(sourceDir, manifest());
      const first = await install(sourceDir);
      await fs.writeFile(path.join(first.dir, "stale.ts"), "// left over\n", "utf8");

      const second = await install(sourceDir, { force: true });
      expect(second.replaced).toBe(true);
      expect(await entries(second.dir)).toEqual(["index.ts", "package.json"]);
    });

    test("a directory that is not there says so plainly", async () => {
      await expect(install(path.join(root, "nowhere"))).rejects.toThrow(/no such directory/);
    });

    test("nothing is left staged after a refusal", async () => {
      await writePackage(sourceDir, manifest({ silo: { silo: "^99" } }));
      await expect(install(sourceDir)).rejects.toThrow();
      expect((await entries(pluginsDir)).filter((e) => e.startsWith(".silo-add-"))).toEqual([]);
    });
  });

  describe("the lockfile", () => {
    test("records what was installed, and where it came from", async () => {
      await writePackage(sourceDir, manifest());
      await install(sourceDir);

      const entry = (await PluginLock.open(pluginsDir)).get("silo-plugin-slug");
      expect(entry).toMatchObject({ source: "directory", spec: sourceDir, resolved: sourceDir });
      expect(Date.parse(entry!.installed_at)).toBeGreaterThan(0);
    });

    test("is a record and not a resolver — nothing reads it to load a plugin", async () => {
      await writePackage(sourceDir, manifest());
      const result = await install(sourceDir);
      await fs.rm(path.join(pluginsDir, PluginLock.FileName));

      // Deleting it changes nothing about what silo would load, which is the
      // asymmetry that keeps silo.toml the single management surface (D31).
      expect((await ManifestReader.read(pluginsDir, result.name)).dir).toBe(result.dir);
    });

    test("a lockfile from a different silo is refused rather than guessed at", async () => {
      await fs.mkdir(pluginsDir, { recursive: true });
      await fs.writeFile(
        path.join(pluginsDir, PluginLock.FileName),
        JSON.stringify({ lockfile_version: 99, plugins: {} }),
        "utf8"
      );
      await expect(PluginLock.open(pluginsDir)).rejects.toThrow(/lockfile_version 99/);
    });

    test("an unreadable lockfile is refused before anything is installed", async () => {
      await fs.mkdir(pluginsDir, { recursive: true });
      await fs.writeFile(
        path.join(pluginsDir, PluginLock.FileName),
        JSON.stringify({ lockfile_version: 99, plugins: {} }),
        "utf8"
      );
      await writePackage(sourceDir, manifest());

      // The refusal has to land *before* the fetch, or it arrives once the
      // plugin is already on disk — the half-done state everything else here
      // is arranged to prevent.
      await expect(install(sourceDir)).rejects.toThrow(/lockfile_version 99/);
      expect(await entries(pluginsDir)).toEqual([PluginLock.FileName]);
    });

    test("entries are sorted, so an instance directory stays diffable", async () => {
      await writePackage(sourceDir, manifest({ name: "silo-plugin-zebra" }));
      await install(sourceDir);
      await writePackage(sourceDir, manifest({ name: "silo-plugin-alpha" }));
      await install(sourceDir);

      const text = await fs.readFile(path.join(pluginsDir, PluginLock.FileName), "utf8");
      expect(text.indexOf("silo-plugin-alpha")).toBeLessThan(text.indexOf("silo-plugin-zebra"));
    });
  });
});
