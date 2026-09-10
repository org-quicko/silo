/**
 * Mirrors the emitted `.d.ts` tree as a `.d.cts` one, so the `require`
 * condition has declarations of its own.
 *
 * One `.d.ts` serving both conditions is TypeScript's documented failure mode
 * under `node16` and `nodenext` resolution, and copying only `index.d.ts` is
 * not enough: its relative imports would still resolve into the ESM tree, so a
 * CommonJS consumer would read ESM declarations for every type behind the
 * entry point. Every file is copied and every relative specifier is rewritten
 * from `./x.js` to `./x.cjs`, which resolves to the `.d.cts` beside it.
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

class CommonJsDeclarations {
  private static readonly Root = join(import.meta.dir, "..", "dist");
  private static readonly RelativeSpecifier = /(from\s*")(\.{1,2}\/[^"]*?)\.js(")/g;

  static async emit(): Promise<void> {
    const written = await CommonJsDeclarations.mirror(CommonJsDeclarations.Root);
    console.log(`emitted ${written} .d.cts declaration files`);
  }

  private static async mirror(directory: string): Promise<number> {
    let written = 0;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        written += await CommonJsDeclarations.mirror(path);
        continue;
      }
      if (!entry.name.endsWith(".d.ts")) continue;

      const source = await readFile(path, "utf8");
      await writeFile(
        path.replace(/\.d\.ts$/, ".d.cts"),
        source.replace(CommonJsDeclarations.RelativeSpecifier, '$1$2.cjs$3'),
        "utf8"
      );
      written += 1;
    }
    return written;
  }
}

await CommonJsDeclarations.emit();
