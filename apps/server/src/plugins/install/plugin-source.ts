/**
 * Where a plugin is being installed from (D32).
 *
 * Five kinds, and the set is closed on purpose: each one is a different
 * answer to "what can this instance verify about the bytes it is about to
 * run". A local directory or tarball is verified by the operator having put
 * it there; an npm package is verified against the registry's own integrity
 * digest; a bare URL is verified only against a digest the operator supplies;
 * a git checkout is not verified at all and is pinned by commit instead.
 *
 * `SourceParser` is the only thing that constructs these, so the classifying
 * rules live in one place rather than being re-derived per fetcher.
 */
export type PluginSource =
  | { kind: "directory"; path: string }
  | { kind: "tarball"; path: string }
  | { kind: "npm"; name: string; range: string }
  | { kind: "url"; url: string }
  | { kind: "git"; url: string; ref?: string };
