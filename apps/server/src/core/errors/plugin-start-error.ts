/**
 * A plugin the supervisor was asked to start, and could not (D39, phase 4).
 *
 * Phase 4 is the first time "start this plugin" is something a **caller** asks
 * for, so it is the first time the answer needs a shape. Before it, every start
 * happened at boot, where a plain `Error` refusing the whole process is exactly
 * right and the operator reads it on stderr.
 *
 * Through the API that same plain error is rendered `internal error` with no
 * detail — and the discarded message is precisely the one the operator needs:
 * *declares `entry.afterWrite` but exports no such function*, or *needs silo ^2,
 * but this is silo 0.2.0*. So it gets its own type, its own code, and the
 * loader's own words, in the shape `MediaDeleteStalledError` already uses for
 * the other failure that is neither a refusal nor a bug.
 *
 * A 500 and not a 400: the request was well formed and the caller did nothing
 * wrong. What failed is the package on disk, and `details.remedy` says so.
 */
export class PluginStartError extends Error {
  readonly plugin: string;

  constructor(plugin: string, cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "PluginStartError";
    this.plugin = plugin;
  }
}
