/**
 * One entry of the ordered `[[plugins]]` array (D31/§13.8).
 *
 * The array's order is hook dispatch order — config-owned, deterministic and
 * debuggable, rather than derived from load order or a priority number that
 * every plugin would then compete over.
 */
export interface PluginConfig {
  /** Resolved under `<storage.path>/plugins/`, as a directory or a
   *  `node_modules/<name>` layout. Both are accepted so the installer that
   *  arrives later needs no config change. */
  name: string;

  /** The claims the operator grants. A plugin's manifest *requests* claims;
   *  this is what it actually gets, and `PluginContext` checks every call
   *  against it with the ordinary claim machinery (D8, D19). Empty means the
   *  plugin can observe but not act. */
  claims: string[];

  /** Per-dispatch bound. Enforceable only under the worker host — inline, a
   *  synchronous spin ignores it (§13.9). */
  timeout_ms: number;

  /** What a *plugin fault* does. A `ValidationError` or `ForbiddenError` from
   *  a hook is a deliberate rejection and is unaffected by this. */
  on_error: "fail" | "skip";

  /** Validated against the manifest's JSON Schema at startup. */
  config: Record<string, unknown>;
}
