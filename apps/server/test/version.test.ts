import { describe, test, expect } from "bun:test";
import path from "path";
import { SiloVersion, PackageVersion } from "../src/version";

/**
 * The version is written down in four manifests and read by five things, and
 * nothing about a stale copy is visible at runtime — a binary reporting last
 * release's number looks exactly like one reporting this release's.
 *
 * These are the assertions `scripts/set-version.ts` exists to keep true, and
 * the reason it rewrites every manifest rather than only the root one.
 */
describe("version", () => {
  // `create-silo-plugin` is not merely tidy here: `SiloRange` derives the
  // version range every scaffolded plugin declares from that manifest, so a
  // stale copy hands new plugin authors a range that refuses the start.
  const manifests = [
    "package.json",
    "apps/server/package.json",
    "apps/admin/package.json",
    "packages/shared/package.json",
    "packages/create-silo-plugin/package.json",
  ];

  test("every workspace manifest agrees with the root", async () => {
    const versions: Record<string, string> = {};
    for (const manifest of manifests) {
      versions[manifest] = JSON.parse(await Bun.file(manifest).text()).version;
    }

    // Asserted as a whole object so a failure names which file disagreed and
    // with what, rather than reporting the first mismatch and stopping.
    expect(versions).toEqual(Object.fromEntries(manifests.map((m) => [m, PackageVersion])));
  });

  test("the runtime version derives from the root manifest", () => {
    expect(SiloVersion.startsWith(PackageVersion)).toBe(true);
  });

  test("a build that is not a release says so", () => {
    // `SILO_VERSION` is set only by a release build, so anything running this
    // suite — from source, or a local compile — must carry the marker. Without
    // it a developer's binary is indistinguishable from a published one, which
    // is how a bug report ends up against the wrong artifact.
    expect(SiloVersion).toBe(`${PackageVersion}-dev`);
  });

  test("a release that cannot carry a define says so through the environment", async () => {
    // The container image runs `bun run main.ts` over this very tree, where no
    // `--define` reaches the constant, so the release stamps the environment at
    // image build time instead (D90). Spawned rather than re-imported, because
    // `SiloVersion` is decided once, when the module is first evaluated.
    const entry = path.join(import.meta.dir, "..", "src", "main.ts");
    const proc = Bun.spawn([process.execPath, entry, "version"], {
      stdout: "pipe",
      stderr: "ignore",
      env: { ...process.env, SILO_VERSION: "9.9.9", NO_COLOR: "1" },
    });
    const [stdout] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);

    expect(stdout.trim()).toBe("silo 9.9.9");
  });

  test("no source file still carries a hard-coded version", async () => {
    // The literals this replaced lived in `Cli`, `Exporter` and the build
    // script, none of which had any reason to know the number.
    const sources = [
      "apps/server/src/cli/cli.ts",
      "apps/server/src/core/transfer/exporter.ts",
      "tools/build/main.ts",
    ];
    for (const file of sources) {
      const text = await Bun.file(file).text();
      const literals = text.match(/"\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?"/g) ?? [];
      expect({ file, literals }).toEqual({ file, literals: [] });
    }
  });
});
