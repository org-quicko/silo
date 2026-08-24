import fs from "fs/promises";
import path from "path";
import { PackageExtractor } from "./package-extractor";
import type { FetchedPackage, PackageFetcher } from "./package-fetcher";

/**
 * `silo add https://github.com/acme/silo-plugin-slug` — a repository (D32).
 *
 * Pinned by **commit**, not by digest. A clone has no publisher-signed
 * artefact to compare against, so recording the resolved sha is the strongest
 * honest claim available: a later install of the same ref that produces a
 * different commit is visible in the lockfile, and a force-push is therefore
 * something an operator can see rather than something that silently happened.
 *
 * `git` is shelled out to rather than reimplemented, and it is the only
 * subprocess anywhere in the install path. It is given `--depth 1` (a plugin
 * is source, not history) and never a credential prompt: a private repo fails
 * fast instead of hanging a CLI that has no terminal.
 */
export class GitFetcher implements PackageFetcher {
  constructor(private readonly url: string, private readonly ref?: string) {}

  async fetch(staging: string): Promise<FetchedPackage> {
    const what = `plugin from ${this.url}`;
    const into = path.join(staging, "package");

    const clone = ["clone", "--depth", "1", "--single-branch"];
    if (this.ref) clone.push("--branch", this.ref);
    await GitFetcher.git([...clone, this.url, into], staging, what);

    const commit = (await GitFetcher.git(["rev-parse", "HEAD"], into, what)).trim();

    // The checkout, not the history: `<data dir>/plugins/` is loaded code and
    // a packed object store in it is dead weight an operator would have to
    // reason about on every backup.
    await fs.rm(path.join(into, ".git"), { recursive: true, force: true });

    return { dir: await PackageExtractor.packageRoot(into, what), resolved: commit };
  }

  private static async git(args: string[], cwd: string, what: string): Promise<string> {
    let proc;
    try {
      proc = Bun.spawn(["git", ...args], {
        cwd,
        stdout: "pipe",
        stderr: "pipe",
        // No interactive credential prompt, and no chance of one blocking a
        // command nobody is watching.
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "echo" },
      });
    } catch {
      throw new Error(`${what}: git is not installed, or not on PATH`);
    }

    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    if (code !== 0) {
      throw new Error(`${what}: git ${args[0]} failed — ${stderr.trim() || `exit ${code}`}`);
    }
    return stdout;
  }
}
