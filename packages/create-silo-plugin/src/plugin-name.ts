/**
 * The plugin's package name, and the directory it lands in.
 *
 * The name is load-bearing twice over: it is what `[[plugins]] name` addresses,
 * and it is the directory `ManifestReader` looks for under `<data dir>/plugins/`.
 * A scoped name therefore resolves to a *nested* directory — `@acme/silo-plugin-slugs`
 * lives at `<data dir>/plugins/@acme/silo-plugin-slugs/` — which is the one
 * thing about the resolution rule that surprises people, so the generated
 * README says it out loud rather than leaving it to be discovered.
 */
export class PluginName {
  /** npm's own rule, minus the length and leading-dot cases handled below:
   *  lowercase, url-safe, optionally scoped. Enforced here because a name npm
   *  will refuse is a name the author cannot publish, and finding that out at
   *  `npm publish` is finding it out after the code is written. */
  private static readonly valid =
    /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

  /** The convention every silo plugin in the wild should follow, so a search
   *  for one finds them. Advisory — `ManifestReader` does not care. */
  static readonly Prefix = "silo-plugin-";

  static problem(name: string): string | null {
    const trimmed = name.trim();
    if (trimmed.length === 0) return "a plugin needs a name";
    if (trimmed.length > 214) return "an npm package name is at most 214 characters";
    if (trimmed !== trimmed.toLowerCase()) return "an npm package name is lowercase";
    if (!PluginName.valid.test(trimmed)) {
      return `"${trimmed}" is not a usable npm package name — lowercase letters, digits, "-", "." and "_", optionally under an @scope`;
    }
    return null;
  }

  /** Not a `problem`: an unconventional name still loads. Shown once, then
   *  dropped, because a scaffolder that argues with the author is worse than
   *  one that names the convention and gets out of the way. */
  static conventionNote(name: string): string | null {
    if (PluginName.unscoped(name).startsWith(PluginName.Prefix)) return null;
    return `heads up: silo plugins are conventionally named "${PluginName.Prefix}<what-it-does>" so they are findable on npm. "${name}" works either way.`;
  }

  /** `@acme/silo-plugin-slugs` → `silo-plugin-slugs`. */
  static unscoped(name: string): string {
    const slash = name.lastIndexOf("/");
    return slash === -1 ? name : name.slice(slash + 1);
  }

  /** Where `create-silo-plugin <name>` puts it by default: a flat directory in
   *  the working directory, named for the package without its scope. The scope
   *  matters where silo resolves the plugin, not where the author writes it —
   *  and a literal `@acme/` directory in a shell prompt is a needless papercut. */
  static defaultDirectory(name: string): string {
    return PluginName.unscoped(name);
  }

  /** The path under `<data dir>/plugins/` silo will look for. Scoped names
   *  keep their scope directory here, because `ManifestReader` joins the whole
   *  name onto the plugins dir. */
  static installPath(name: string): string {
    return name;
  }
}
