import fs from "fs/promises";

/**
 * Sets silo's version everywhere it is written down.
 *
 *   bun run set-version 0.2.0
 *
 * The root `package.json` is the single source of truth at runtime — the
 * binary, the archives, the RPM and the Homebrew formula all derive from it —
 * so bumping it is *almost* the whole job. The workspace manifests are the
 * remainder: `shared` and `ui` are private and never published, which makes
 * their versions inert but not invisible, and a reader cannot tell an inert
 * version from a stale one. They move together so there is nothing to tell
 * apart.
 *
 * It deliberately does not commit or tag. `bun pm version` would do both, and
 * this repository's staging is the author's; the release is a tag they push
 * once the change looks right.
 */
export class SetVersion {
  /**
   * The root first: it is the one anything reads.
   *
   * `create-silo-plugin` is here for a reason the other two are not. `shared`
   * and `ui` are private and their versions are inert; the scaffolder's is
   * *load-bearing*, because `SiloRange` derives the `"silo"` range it writes
   * into every scaffolded manifest from it (`0.2.0` → `^0.2`). Leave it behind
   * on a release and every plugin created afterwards declares a range one
   * version too narrow — which does not degrade, it refuses the start.
   */
  private static readonly manifests = [
    "package.json",
    "shared/package.json",
    "ui/package.json",
    "create-silo-plugin/package.json",
  ];

  /** Semver proper, since the release workflow rejects anything else and it is
   *  better to hear that here than after pushing a tag. */
  private static readonly semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;

  static async run(): Promise<void> {
    const version = Bun.argv[2];
    if (!version) throw new Error("usage: bun run set-version <version>   (e.g. 0.2.0)");
    if (!SetVersion.semver.test(version)) {
      throw new Error(`"${version}" is not a semantic version — expected 1.2.3, or 1.2.3-rc.1 for a pre-release`);
    }

    for (const manifest of SetVersion.manifests) {
      const before = await SetVersion.rewrite(manifest, version);
      console.log(`${manifest.padEnd(22)} ${before} -> ${version}`);
    }

    console.log(`
Nothing was committed or tagged. When the change looks right:

    git commit -am "silo ${version}"
    git tag -a v${version} -m "v${version}" && git push origin v${version}
`);
  }

  /**
   * Rewrites the `version` field in place, by text rather than by reparsing.
   *
   * `JSON.parse` then `JSON.stringify` would reformat the whole file — key
   * order survives, but indentation, the trailing newline and any deliberate
   * spacing do not, and a version bump that reflows three manifests is a
   * version bump nobody can review.
   */
  private static async rewrite(manifest: string, version: string): Promise<string> {
    const source = await Bun.file(manifest).text();
    const current = JSON.parse(source).version;
    if (typeof current !== "string") throw new Error(`${manifest} has no "version" field`);

    // Anchored to the first line that declares it, so a `version` nested in a
    // dependency range or a script cannot be hit instead.
    const field = /(^\s*"version"\s*:\s*")([^"]*)(")/m;
    if (!field.test(source)) throw new Error(`could not locate the "version" field in ${manifest}`);

    await fs.writeFile(manifest, source.replace(field, `$1${version}$3`), "utf8");
    return current;
  }
}

await SetVersion.run();
