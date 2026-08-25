import fs from "fs/promises";
import path from "path";
import { EntryUtils } from "../../core/domain/entry-utils";
import { SiloVersion } from "../../version";
import { ManifestReader } from "../manifest";
import type { PluginManifest } from "../manifest";
import { PluginLoader } from "../registry";
import { ProviderRegistry } from "../registry";
import { DirectoryFetcher } from "./directory-fetcher";
import { GitFetcher } from "./git-fetcher";
import { Integrity } from "./integrity";
import { NpmFetcher } from "./npm-fetcher";
import { NpmRegistry } from "./npm-registry";
import { PluginLock } from "./plugin-lock";
import { SourceParser } from "./source-parser";
import { TarballFetcher } from "./tarball-fetcher";
import { UrlFetcher } from "./url-fetcher";
import type { PackageFetcher } from "./package-fetcher";
import type { PluginSource } from "./plugin-source";

export interface InstallOptions {
  /** `<data dir>/plugins/`, from `PluginRegistry.directory`. */
  pluginsDir: string;
  /** The spec exactly as typed. */
  spec: string;
  /** Git branch or tag, for a repository source. */
  ref?: string;
  /** `sha512-...` the operator supplies. Checked for the three sources with
   *  bytes to hash — `tarball`, `npm` (on top of the registry's own digest) and
   *  `url`; refused for the two without, rather than ignored. */
  integrity?: string;
  /** An alternative npm registry. */
  registry?: string;
  /** Replace an already-installed directory of the same name. */
  force?: boolean;
}

export interface InstallResult {
  name: string;
  manifest: PluginManifest;
  /** Where it now lives. */
  dir: string;
  source: PluginSource;
  resolved: string;
  integrity?: string;
  /** True when an existing installation of the same name was overwritten. */
  replaced: boolean;
  /** Things worth saying that are not worth refusing over. */
  warnings: string[];
}

/**
 * `silo add` — acquiring a plugin, checking it, and putting it where the
 * loader will find it (D32).
 *
 * An installer that changes **nothing** about the contract: it writes a
 * directory the resolution rule frozen in §13.3 already describes, and nothing
 * downstream can tell an installed plugin from one copied in by hand.
 *
 * Two rules govern the order of operations, both about what is on disk when
 * something goes wrong:
 *
 *  - **Nothing is executed.** The manifest is read and judged statically
 *    (§13.2) without importing a line of the package, and no lifecycle script
 *    runs at any point.
 *  - **Nothing lands until everything passes.** The package is staged inside
 *    the plugins directory, so the final step is a rename, and a failure after
 *    it rolls back. A half-installed plugin is the outcome worth the most
 *    effort to avoid.
 */
export class PluginInstaller {
  static async install(options: InstallOptions): Promise<InstallResult> {
    const source = SourceParser.parse(options.spec, options.ref);
    PluginInstaller.assertIntegrityUsable(source, options.integrity);
    const fetcher = PluginInstaller.fetcher(source, options);

    await fs.mkdir(options.pluginsDir, { recursive: true });

    // Opened before anything is fetched, not after the move: a lockfile this
    // silo cannot read is a refusal, and a refusal that arrives once the
    // plugin is already on disk would leave exactly the half-done state the
    // rest of this method is arranged to prevent.
    const lock = await PluginLock.open(options.pluginsDir);
    const staging = await fs.mkdtemp(path.join(options.pluginsDir, ".silo-add-"));

    try {
      const fetched = await fetcher.fetch(staging);
      const pkg = await PluginInstaller.manifestJson(fetched.dir);
      const name = PluginInstaller.name(pkg, source);

      // Static checks, in the order that produces the most useful failure: a
      // malformed manifest before an incompatible one, and an incompatible one
      // before a driver collision nobody can act on until the first two pass.
      const manifest = ManifestReader.validate(name, pkg);
      PluginInstaller.assertCompatible(name, manifest);
      PluginInstaller.assertDriverAvailable(name, manifest);

      const target = PluginInstaller.target(options.pluginsDir, name);
      const replaced = await PluginInstaller.clearTarget(target, name, !!options.force);

      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.rename(fetched.dir, target);

      // The same call `serve` will make. Anything the static pass could not
      // see — a "main" naming a file that is not there — fails here, with the
      // directory removed again rather than left for the next start to trip on.
      try {
        await ManifestReader.read(options.pluginsDir, name);
      } catch (error) {
        await PluginInstaller.rollback(options.pluginsDir, target);
        throw error;
      }

      await lock.record(name, {
        source: source.kind,
        spec: options.spec,
        resolved: fetched.resolved,
        integrity: fetched.integrity,
        installed_at: new Date().toISOString(),
      });

      return {
        name,
        manifest,
        dir: target,
        source,
        resolved: fetched.resolved,
        integrity: fetched.integrity,
        replaced,
        warnings: PluginInstaller.warnings(pkg, source, fetcher),
      };
    } finally {
      await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
    }
  }

  /**
   * A digest the operator supplied has to be used, or it has to say why not.
   *
   * `--integrity` was accepted and then silently dropped for every source but
   * `url`, which is the worst possible handling of a security flag: the
   * operator types the one argument that says "check this" and the install
   * proceeds unchecked, with no output distinguishing that from a verified
   * one. The three sources with bytes to hash now honour it, and the two
   * without say so rather than ignoring it — a `directory` transfers nothing to
   * hash, and a `git` checkout has no publisher artifact and is pinned by
   * commit instead.
   *
   * The shape is validated here too, before any network or disk work, so a
   * typo'd digest fails in the first millisecond rather than after a download.
   */
  private static assertIntegrityUsable(source: PluginSource, integrity: string | undefined): void {
    if (integrity === undefined) return;

    if (source.kind === "directory" || source.kind === "git") {
      const because =
        source.kind === "directory"
          ? `a directory is not a file to hash — nothing is downloaded`
          : `a git checkout has no published artifact to hash, and is pinned by commit instead`;
      throw new Error(`--integrity does not apply to a ${source.kind} source: ${because}.`);
    }

    if (!Integrity.isValid(integrity)) {
      throw new Error(`--integrity "${integrity}" is not a digest (expected "sha512-<base64>").`);
    }
  }

  private static fetcher(source: PluginSource, options: InstallOptions): PackageFetcher {
    switch (source.kind) {
      case "directory":
        return new DirectoryFetcher(source.path);
      case "tarball":
        return new TarballFetcher(source.path, options.integrity);
      case "npm":
        return new NpmFetcher(
          source.name,
          source.range,
          new NpmRegistry(options.registry),
          options.integrity
        );
      case "url":
        return new UrlFetcher(source.url, options.integrity);
      case "git":
        return new GitFetcher(source.url, source.ref);
    }
  }

  private static async manifestJson(dir: string): Promise<any> {
    const file = path.join(dir, "package.json");
    try {
      return JSON.parse(await fs.readFile(file, "utf8"));
    } catch (error: any) {
      throw new Error(`cannot read the package's package.json: ${error.message}`);
    }
  }

  /**
   * The package's own `name` decides where it is installed, because that is
   * the name `silo.toml` will have to use and the name the resolution rule
   * resolves. A spec that disagrees is a substituted package, not a rename.
   */
  private static name(pkg: any, source: PluginSource): string {
    if (typeof pkg.name !== "string" || pkg.name.length === 0) {
      throw new Error(`the package declares no "name" in its package.json`);
    }
    if (source.kind === "npm" && pkg.name !== source.name) {
      throw new Error(
        `asked for "${source.name}" but the registry served a package named "${pkg.name}". Not installing.`
      );
    }
    return pkg.name;
  }

  /** The same gate `PluginLoader` applies at startup, applied now — installing
   *  something that provably cannot load is a worse way to find out. */
  private static assertCompatible(name: string, manifest: PluginManifest): void {
    if (PluginLoader.compatible(manifest.silo)) return;
    throw new Error(
      `plugin "${name}": needs silo ${manifest.silo}, but this is silo ${SiloVersion}. Not installing.`
    );
  }

  /** Checked here as well as at registration, because a provider that can
   *  never be selected is worth catching before it is on disk. Every driver the
   *  package contributes, since D36 lets it contribute more than one. */
  private static assertDriverAvailable(name: string, manifest: PluginManifest): void {
    for (const provider of manifest.contributes.providers) {
      if (!ProviderRegistry.Reserved.includes(provider.driver)) continue;
      throw new Error(
        `plugin "${name}": provides driver "${provider.driver}", which is reserved for a ` +
          `built-in adapter.`
      );
    }
  }

  /** `<plugins dir>/<name>`, with every component held to the rule the fs
   *  adapter holds a collection id to — a package name reaches the filesystem
   *  here exactly as an entry id does there (§13.8). */
  private static target(pluginsDir: string, name: string): string {
    const segments = name.split("/");
    for (const segment of segments) EntryUtils.assertSafeSegment(segment, "package name component");
    return path.join(pluginsDir, ...segments);
  }

  private static async clearTarget(target: string, name: string, force: boolean): Promise<boolean> {
    try {
      if (!(await fs.stat(target)).isDirectory()) return false;
    } catch {
      return false;
    }

    if (!force) {
      throw new Error(
        `plugin "${name}" is already installed at ${target}. ` +
          `Pass --force to replace it, or remove the directory yourself.`
      );
    }
    await fs.rm(target, { recursive: true, force: true });
    return true;
  }

  /** Undo a move, including the scope directory it may have created — an empty
   *  `@acme/` left behind would make the next `plugin list` look wrong. */
  private static async rollback(pluginsDir: string, target: string): Promise<void> {
    await fs.rm(target, { recursive: true, force: true }).catch(() => {});
    const parent = path.dirname(target);
    if (path.resolve(parent) === path.resolve(pluginsDir)) return;
    await fs.rmdir(parent).catch(() => {});
  }

  /**
   * What the operator should know but should not be stopped by.
   *
   * Dependencies are the interesting one. §13.3 makes a plugin's dependency on
   * silo zero, and in practice that covers most of what a plugin needs; silo
   * installs no dependency tree and says so, rather than growing a resolver to
   * serve a case the contract already argues should not exist.
   */
  private static warnings(pkg: any, source: PluginSource, fetcher: PackageFetcher): string[] {
    const warnings: string[] = [];

    const dependencies = Object.keys(pkg.dependencies ?? {});
    if (dependencies.length > 0) {
      const shown = dependencies.slice(0, 3).join(", ");
      warnings.push(
        `it declares ${dependencies.length} dependenc${dependencies.length === 1 ? "y" : "ies"} ` +
          `(${shown}${dependencies.length > 3 ? ", ..." : ""}). silo installs none — the package ` +
          `must vendor them, or the plugin will fail to load.`
      );
    }

    if (fetcher instanceof UrlFetcher && !fetcher.verified) {
      warnings.push(
        `nothing verified these bytes but TLS. Pass --integrity sha512-... to check a download ` +
          `against a digest you already trust.`
      );
    }
    if (source.kind === "git") {
      warnings.push("a git checkout carries no publisher digest; it is pinned by commit instead.");
    }
    return warnings;
  }
}
