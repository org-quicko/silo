import fs from "fs/promises";
import path from "path";
import type { Config } from "../../config/config";
import { NotFoundError } from "../../core/errors/not-found-error";
import { ValidationError } from "@silo/shared/validation-error";
import { PluginLoader } from "./plugin-loader";
import { PluginRegistry } from "./plugin-registry";

/** One plugin's panel, as `GET /api/plugins/{name}/ui` answers it. */
export interface PluginPanelSource {
  /** The declared title, or the package's name. */
  title: string;
  /** The file it came from, relative to the package — echoed so a client can
   *  say *which* file it is showing when an author has more than one branch of
   *  a build pointing at this manifest. */
  entry: string;
  /** The panel's own HTML. **Not** served as a document — see `PluginPanel`. */
  html: string;
}

/**
 * Reads a plugin's declared admin panel off disk (D41).
 *
 * Beside `PluginInspector` and not inside it, though both read a package and
 * change nothing: the inspector answers many small questions in one pass for a
 * management view, and this answers one large one for a single route. Folding a
 * possibly-megabyte string into `PluginFacts` would put it on every
 * `GET /api/plugins` response, which is the opposite of what that pass is for.
 *
 * **The bytes are never served as a document.** `PluginPanelRoute` sends them
 * with a non-renderable content type, `nosniff`, and a `Content-Disposition`
 * that keeps a browser from displaying them at all, because the API and the
 * admin SPA share an origin and the admin keeps an API key per configured
 * instance in that origin's `localStorage`. A plugin's HTML rendered there would
 * be a credential-exfiltration primitive for every silo the operator has ever
 * connected to — not for this one. So the transport treats a panel as data, and
 * only the admin turns it into a document, in an iframe with no origin of its
 * own.
 *
 * A panel is read fresh on every request rather than cached. It is an operator
 * opening a screen, so the cost is one file read per look, and the alternative
 * is a stale panel after an upgrade with nothing to invalidate it — the
 * manifest is read before the worker starts, so there is no event here to hang
 * an invalidation on.
 */
export class PluginPanel {
  /**
   * The largest panel silo will read.
   *
   * A panel is inlined whole — no directory, so its CSS and script are in the
   * file — and it crosses a JSON response and then a `srcdoc` attribute, so its
   * cost is paid several times over. 2 MiB is far past any hand-written screen
   * and far short of a bundle somebody vendored a framework into, which is the
   * mistake this refuses by name rather than by timing out.
   */
  static readonly MaxBytes = 2 * 1024 * 1024;

  static async read(
    config: Config,
    name: string
  ): Promise<PluginPanelSource> {
    const declared = config.plugins.find((plugin) => plugin.name === name);
    if (!declared) {
      throw new NotFoundError(
        `plugin "${name}" is not listed in silo.toml, so there is no package to read a panel ` +
          `from. Its grant is kept and applies again the moment it is listed.`
      );
    }

    const resolved = await PluginLoader.resolve(PluginRegistry.directory(config), declared);
    const ui = resolved.manifest.contributes.ui;
    if (!ui) {
      throw new NotFoundError(
        `plugin "${name}" contributes no admin panel. A package declares one as ` +
          `"silo.contributes.ui": { "entry": "./panel.html" }.`
      );
    }

    // Resolved and then re-checked against the package directory. The manifest
    // reader already refused "..", so this cannot fail — which is exactly why it
    // is here: the reader is one edit away from being relaxed, and this is the
    // check that has to hold when it is. A symlink is the case the grammar
    // genuinely cannot see.
    const file = path.resolve(resolved.dir, ui.entry);
    const root = path.resolve(resolved.dir);
    if (file !== root && !file.startsWith(root + path.sep)) {
      throw new ValidationError(
        `plugin "${name}": its panel "${ui.entry}" resolves outside the package directory`
      );
    }

    return {
      title: ui.title ?? resolved.manifest.name,
      entry: ui.entry,
      html: await PluginPanel.contents(name, ui.entry, file),
    };
  }

  private static async contents(name: string, entry: string, file: string): Promise<string> {
    let stat;
    try {
      stat = await fs.stat(file);
    } catch {
      throw new NotFoundError(
        `plugin "${name}": its manifest declares the panel "${entry}", and there is no such ` +
          `file in the package.`
      );
    }
    if (!stat.isFile()) {
      throw new ValidationError(`plugin "${name}": its panel "${entry}" is not a file`);
    }
    if (stat.size > PluginPanel.MaxBytes) {
      throw new ValidationError(
        `plugin "${name}": its panel "${entry}" is ${stat.size} bytes; silo reads at most ` +
          `${PluginPanel.MaxBytes}. A panel is one inlined file, not a bundle.`
      );
    }
    return await fs.readFile(file, "utf8");
  }
}
