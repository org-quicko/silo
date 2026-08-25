import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * The files this scaffolder copies out verbatim rather than rendering.
 *
 * Two of them, and each is verbatim for a reason. `silo-api.d.ts` is silo's own
 * `apps/server/src/plugins/host/silo-api-types.d.ts`, byte for byte — the README
 * currently tells plugin authors to copy that file by hand, and automating a
 * hand-copy is most of this tool's value. `test/silo-api-drift.test.ts` fails
 * the repo's suite the moment the two diverge, which is the only thing keeping
 * a published copy honest.
 *
 * Resolved from `import.meta.url`, never `process.cwd()`: the working
 * directory when this runs is wherever the author invoked `npm create`, and
 * `assets/` sits beside `dist/` inside the installed package. The relative
 * path is the same from `src/` and from the bundled `dist/cli.js`, so running
 * from source and running as published resolve identically.
 */
export class Assets {
  private static readonly dir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "assets"
  );

  /**
   * `assets/gitignore` → the plugin's `.gitignore`.
   *
   * The leading dot is added on write because npm **excludes `.gitignore` from
   * published tarballs** — it is one of the handful of always-ignored names.
   * A dotless file in `assets/` is the standard way around that, and the
   * rename is why this map exists rather than a straight copy.
   */
  static readonly Files: readonly { asset: string; target: string }[] = [
    { asset: "silo-api.d.ts", target: "silo-api.d.ts" },
    { asset: "tsconfig.json", target: "tsconfig.json" },
    { asset: "gitignore", target: ".gitignore" },
  ];

  static async read(asset: string): Promise<string> {
    return await fs.readFile(path.join(Assets.dir, asset), "utf8");
  }

  /** Exposed for the drift test, which compares this directory's copy against
   *  silo's original. */
  static path(asset: string): string {
    return path.join(Assets.dir, asset);
  }
}
