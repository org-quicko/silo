import path from "path";

/**
 * Where the admin UI comes from at runtime: the embedded copy in a release
 * binary, or `apps/admin/dist` on disk in a source checkout.
 *
 * A release build embeds the UI through Bun's `with { type: "file" }` imports,
 * whose content-hashed paths bear no resemblance to the request path — so
 * something has to hold the map. `tools/build/` generates it and calls
 * {@link useEmbedded} before the CLI starts. See `docs/design/build-and-release.md`.
 */
export class UiAssets {
  /** Set only in a compiled release build; null means "read from disk". */
  private static embeddedPaths: Record<string, string> | null = null;

  /** Relative to the working directory, matching the documented dev flow:
   *  `bun run --cwd apps/admin build` next to `bun run start`. */
  private static readonly diskRoot = "./apps/admin/dist";

  /**
   * Registers the embedded UI. Keys are request paths rooted at `/`
   * (`/index.html`, `/assets/index-DtDrClKw.js`); values are the paths Bun's
   * file imports resolved to.
   */
  static useEmbedded(assetPaths: Record<string, string>): void {
    UiAssets.embeddedPaths = assetPaths;
  }

  /** Whether this binary carries its own copy of the UI. */
  static isEmbedded(): boolean {
    return UiAssets.embeddedPaths !== null;
  }

  /**
   * The file for a request path, or null when there is no such asset.
   *
   * Existence is checked for the disk case only — an embedded path came out of
   * the build, so it is there by construction.
   */
  static async resolve(requestPath: string): Promise<Bun.BunFile | null> {
    const embeddedPaths = UiAssets.embeddedPaths;
    if (embeddedPaths) {
      const embedded = embeddedPaths[requestPath];
      return embedded ? Bun.file(embedded) : null;
    }

    const relativePath = UiAssets.safeRelative(requestPath);
    if (relativePath === null) return null;

    const file = Bun.file(path.join(UiAssets.diskRoot, relativePath));
    return (await file.exists()) ? file : null;
  }

  /** The SPA shell, for any route the client router owns. */
  static async index(): Promise<Bun.BunFile | null> {
    return UiAssets.resolve("/index.html");
  }

  /**
   * A request path as a path relative to the UI root, or null if it escapes.
   *
   * The disk branch joins onto a root, so `GET /../../etc/passwd` would read
   * exactly that. Normalising first and rejecting anything still leading with
   * `..` rules out the literal and encoded forms alike — Hono has already
   * decoded the path by the time it reaches here.
   */
  private static safeRelative(requestPath: string): string | null {
    const normalized = path.posix.normalize(requestPath);
    if (!normalized.startsWith("/")) return null;

    const relativePath = normalized.slice(1);
    if (relativePath === "" || relativePath.startsWith("../")) return null;
    return relativePath;
  }
}
