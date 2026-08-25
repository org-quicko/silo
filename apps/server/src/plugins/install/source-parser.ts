import path from "path";
import type { PluginSource } from "./plugin-source";

/**
 * Classifies the one argument `silo add` takes (D32).
 *
 * There is no `--from npm` flag, because every spec shape here is already
 * unambiguous to a human reading it and a flag would only let the two
 * disagree. The rules are ordered most-specific first and each is written to
 * be explainable in one line, since the failure mode that matters is a
 * spec that installs from somewhere the operator did not mean.
 */
export class SourceParser {
  /** Hosts whose bare `https://` URLs are repositories rather than files.
   *  Anything else is treated as a tarball URL, which is the safer default:
   *  fetching a file that turns out not to be one fails loudly, whereas
   *  cloning a URL the operator meant as a download is a surprise. */
  private static readonly GitHosts: readonly string[] = [
    "github.com",
    "gitlab.com",
    "bitbucket.org",
    "codeberg.org",
    "git.sr.ht",
  ];

  private static readonly TarballSuffixes: readonly string[] = [".tgz", ".tar.gz", ".tar"];

  static parse(raw: string, ref?: string): PluginSource {
    const spec = raw.trim();
    if (spec.length === 0) throw new Error(`no plugin specified`);

    if (SourceParser.isLocalPath(spec)) return SourceParser.local(spec);
    if (SourceParser.isGit(spec)) return { kind: "git", url: SourceParser.gitUrl(spec), ref };
    if (/^https?:\/\//i.test(spec)) return { kind: "url", url: spec };
    return SourceParser.npm(spec);
  }

  /** A path, not a package name. `file:` is accepted because npm specs use it
   *  and someone will type it out of habit. */
  private static isLocalPath(spec: string): boolean {
    if (spec.startsWith("file:")) return true;
    if (spec === "." || spec === "..") return true;
    if (/^[.~]{1,2}[/\\]/.test(spec)) return true;
    if (spec.startsWith("/") || spec.startsWith("\\")) return true;
    return /^[a-zA-Z]:[/\\]/.test(spec); // C:\plugins\slug
  }

  private static local(spec: string): PluginSource {
    const stripped = spec.startsWith("file:") ? spec.slice("file:".length) : spec;
    const resolved = path.resolve(stripped);
    return SourceParser.looksLikeTarball(resolved)
      ? { kind: "tarball", path: resolved }
      : { kind: "directory", path: resolved };
  }

  private static isGit(spec: string): boolean {
    if (spec.startsWith("git+") || spec.startsWith("git://")) return true;
    if (/^[^/]+@[^/]+:.+/.test(spec) && !spec.includes("://")) return true; // git@github.com:acme/x
    if (!/^https?:\/\//i.test(spec)) return false;
    if (SourceParser.looksLikeTarball(spec)) return false;
    if (spec.endsWith(".git")) return true;

    try {
      return SourceParser.GitHosts.includes(new URL(spec).hostname.toLowerCase());
    } catch {
      return false;
    }
  }

  /** `git+https://…` is npm's spelling of a URL git itself does not want the
   *  prefix on. `git://` is left alone — it is git's own scheme. */
  private static gitUrl(spec: string): string {
    return spec.startsWith("git+") ? spec.slice("git+".length) : spec;
  }

  private static looksLikeTarball(value: string): boolean {
    const lower = value.toLowerCase().split(/[?#]/)[0]!;
    return SourceParser.TarballSuffixes.some((suffix) => lower.endsWith(suffix));
  }

  /**
   * `name`, `name@range`, `@scope/name`, `@scope/name@range`.
   *
   * The version is split from the *last* `@` rather than the first, which is
   * the only rule that gets `@acme/silo-plugin-slugs@^1` right.
   */
  private static npm(spec: string): PluginSource {
    const at = spec.lastIndexOf("@");
    const scoped = spec.startsWith("@");
    const hasRange = at > 0 && !(scoped && at === 0);

    const name = hasRange ? spec.slice(0, at) : spec;
    const range = hasRange ? spec.slice(at + 1) : "latest";

    if (!/^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i.test(name)) {
      throw new Error(
        `"${spec}" is not a package name, a path, or a URL. ` +
          `Use a name ("silo-plugin-slug"), a path ("./my-plugin"), or a URL.`
      );
    }
    return { kind: "npm", name, range: range.length > 0 ? range : "latest" };
  }
}
