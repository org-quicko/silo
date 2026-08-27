import fs from "node:fs/promises";
import path from "node:path";
import { Assets } from "./assets";
import { Manifest } from "./render/manifest";
import { ExtensionModule } from "./render/extension-module";
import { ProviderModule } from "./render/provider-module";
import { PluginReadme } from "./render/plugin-readme";
import type { ScaffoldOptions } from "./scaffold-options";

/**
 * Writes the plugin directory.
 *
 * Every decision is already made by the time this runs — `ScaffoldOptions` has
 * no optional extension fields and no "was the author prompted" flag — so this
 * class contains no branch that a prompt could reach and none that `--yes`
 * could take differently. That is what keeps the interactive path and the
 * scripted path from being two subtly different scaffolders.
 *
 * It refuses a non-empty directory unless `--force`. Not because overwriting
 * is hard, but because the directory an author names is frequently one they
 * already have work in, and there is nothing in a scaffold worth silently
 * replacing an `index.ts` for.
 */
export class Scaffold {
  static async create(options: ScaffoldOptions): Promise<string[]> {
    const dir = path.resolve(options.directory);
    await Scaffold.assertWritable(dir, options.force);
    await fs.mkdir(dir, { recursive: true });

    const written: string[] = [];
    const write = async (name: string, contents: string) => {
      await fs.writeFile(path.join(dir, name), contents, "utf8");
      written.push(name);
    };

    await write("package.json", Manifest.render(options));
    await write(
      "index.ts",
      options.kind === "extension" ? ExtensionModule.render(options) : ProviderModule.render(options)
    );
    await write("README.md", PluginReadme.render(options));

    for (const file of Assets.Files) {
      await write(file.target, await Assets.read(file.asset));
    }
    if (options.panel) {
      await write(Assets.Panel.target, await Assets.read(Assets.Panel.asset));
    }

    return written;
  }

  /**
   * A directory that does not exist is fine; one that exists and is empty is
   * fine; one holding anything at all needs `--force`.
   *
   * "Anything at all" includes dotfiles, deliberately: a directory with a
   * `.git` in it is somebody's repository, and that is exactly the case where
   * a silent scaffold is worst.
   */
  private static async assertWritable(dir: string, force: boolean): Promise<void> {
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch (err: any) {
      if (err?.code === "ENOENT") return;
      throw err;
    }

    if (entries.length === 0 || force) return;
    throw new Error(
      `${dir} is not empty (${entries.length} ${entries.length === 1 ? "entry" : "entries"}). ` +
        `Pass --force to write into it anyway, or choose another directory.`
    );
  }
}
