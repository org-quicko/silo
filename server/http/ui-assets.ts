import path from "path";

/**
 * Where the admin UI comes from at runtime.
 *
 * A silo installed from a package manager is a single file on `$PATH`, run from
 * whatever directory the user happens to be in, so the UI cannot be read from
 * `./ui/dist` the way it is in a source checkout — there is no `ui/` next to the
 * binary and no reason the working directory should have one. A release build
 * therefore *embeds* `ui/dist` in the executable and hands the routes in here at
 * startup; every other way of running silo keeps reading the directory.
 *
 * Embedding works through Bun's `with { type: "file" }` imports, which survive
 * `--compile` as paths under Bun's virtual filesystem (`/$bunfs/root/...`) that
 * `Bun.file` reads like any other path. Those paths are content-hashed and bear
 * no resemblance to the request path, which is the whole reason this class
 * exists: something has to hold the route -> embedded path map. `scripts/build.ts`
 * generates it, and the generated entrypoint calls {@link useEmbedded} before it
 * starts the CLI.
 */
export class UiAssets {
  /** Set only in a compiled release build; null means "read from disk". */
  private static embedded: Record<string, string> | null = null;

  /** Read relative to the working directory, matching the documented dev flow
   *  (`bun run --cwd ui build` next to `bun run server/main.ts serve`). */
  private static readonly diskRoot = "./ui/dist";

  /**
   * Registers the embedded UI. Keys are request paths rooted at `/`
   * (`/index.html`, `/assets/index-DtDrClKw.js`); values are the paths Bun's
   * file imports resolved to.
   */
  static useEmbedded(assets: Record<string, string>): void {
    UiAssets.embedded = assets;
  }

  /** Whether this binary carries its own copy of the UI. */
  static isEmbedded(): boolean {
    return UiAssets.embedded !== null;
  }

  /**
   * The file for a request path, or null when there is no such asset.
   *
   * Existence is checked for the disk case only. An embedded path came out of
   * the build, so it is there by construction, and `Bun.file(...).exists()` on
   * every request would be a syscall to learn something already known.
   */
  static async resolve(requestPath: string): Promise<Bun.BunFile | null> {
    const embedded = UiAssets.embedded;
    if (embedded) {
      const hit = embedded[requestPath];
      return hit ? Bun.file(hit) : null;
    }

    const rel = UiAssets.safeRelative(requestPath);
    if (rel === null) return null;

    const file = Bun.file(path.join(UiAssets.diskRoot, rel));
    return (await file.exists()) ? file : null;
  }

  /** The SPA shell, for any route the client router owns. */
  static async index(): Promise<Bun.BunFile | null> {
    return UiAssets.resolve("/index.html");
  }

  /**
   * A request path as a path relative to the UI root, or null if it escapes.
   *
   * The embedded map cannot be traversed out of — a key either exists or does
   * not — but the disk branch joins onto a root, and `GET /../../etc/passwd`
   * would otherwise read exactly that. Normalising first and rejecting anything
   * still leading with `..` rules out both the literal form and the encoded one,
   * since Hono has already decoded the path by the time it reaches here.
   */
  private static safeRelative(requestPath: string): string | null {
    const normalized = path.posix.normalize(requestPath);
    if (!normalized.startsWith("/")) return null;

    const rel = normalized.slice(1);
    if (rel === "" || rel.startsWith("../")) return null;
    return rel;
  }
}
