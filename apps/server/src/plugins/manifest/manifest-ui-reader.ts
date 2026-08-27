import type { PluginUi } from "./plugin-ui";

/**
 * Validates `silo.contributes.ui` (D41).
 *
 * Its own file because it is the same shape of problem `ManifestRoutesReader`
 * is — a grammar whose every rule is a way out of the namespace the package was
 * given — and because the two grammars have nothing to do with each other.
 *
 * The check that matters most is `..`, and the reason is not the usual one. A
 * panel path is resolved against the plugin's own directory and then **read by
 * silo and returned over the API**, so a path that climbs out is not a plugin
 * reading its own files (which it may already do — a worker holds full Bun
 * privileges) but silo being asked to read an arbitrary file and hand it to
 * whoever holds `plugins:read`. That is a different authority, and the refusal
 * belongs here where it names the package rather than at the read where it would
 * name a filename.
 */
export class ManifestUiReader {
  /** The only extension a panel may have. Not a content-type negotiation: the
   *  bytes are served as data and become a document only inside the admin's
   *  iframe, so the extension is a statement of intent that stops a manifest
   *  pointing at a `.ts` or a `.db` by mistake. */
  private static readonly Extension = ".html";

  static read(name: string, raw: unknown): PluginUi | null {
    if (raw === undefined || raw === null) return null;
    if (typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error(
        `plugin "${name}": "silo.contributes.ui" must be an object — ` +
          `{ "entry": "./panel.html", "title": "…" }.`
      );
    }

    const block = raw as Record<string, unknown>;
    const title = block.title;
    if (title !== undefined && (typeof title !== "string" || title.trim().length === 0)) {
      throw new Error(
        `plugin "${name}": "silo.contributes.ui.title" must be a non-empty string when present; ` +
          `omit it to use the package name.`
      );
    }

    return {
      entry: ManifestUiReader.entry(name, block.entry),
      ...(title === undefined ? {} : { title: title.trim() }),
    };
  }

  private static entry(name: string, raw: unknown): string {
    const at = (why: string) =>
      new Error(`plugin "${name}": "silo.contributes.ui.entry" ${JSON.stringify(raw)} ${why}.`);

    if (typeof raw !== "string" || raw.trim().length === 0) {
      throw at("must be a non-empty string naming an HTML file inside the package");
    }
    const entry = raw.trim();

    // Windows separators are refused rather than normalised: a manifest is
    // written once and read on every platform, so the one that only works where
    // it was authored is the one to refuse out loud.
    if (entry.includes("\\")) throw at('must use "/" as its separator, on every platform');
    if (entry.startsWith("/")) throw at("must be relative to the package directory");
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(entry)) throw at("must be a path, not a URL");
    if (entry.includes("?") || entry.includes("#")) throw at("must not carry a query or a fragment");
    if (!entry.toLowerCase().endsWith(ManifestUiReader.Extension)) {
      throw at(`must name a ${ManifestUiReader.Extension} file`);
    }

    for (const segment of entry.split("/")) {
      // A leading "./" is idiomatic in a manifest and means nothing, so it is
      // dropped rather than refused — unlike "..", which is the whole point of
      // this loop.
      if (segment === "" || segment === ".") continue;
      if (segment === "..") {
        throw at(
          'must not contain ".." — silo reads this file and serves it, so a path that ' +
            "climbs out of the package would make the API read whatever it names"
        );
      }
    }
    return entry;
  }
}
