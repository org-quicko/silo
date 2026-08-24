/**
 * The plugin system (D31/§13).
 *
 * Four submodules, each with one job: `manifest/` reads and validates what a
 * plugin declares without running it, `host/` executes plugin code behind the
 * `PluginHost` port, `runtime/` is what a running plugin can see and do, and
 * `registry/` is the single explicit wiring site everything else goes through.
 *
 * Import from here, not from a file inside — the internal layout is ours to
 * change, and the surface a plugin's *host* presents is not the same thing as
 * the surface a plugin sees (that one is `silo:api`, and it is frozen).
 */
export * from "./manifest";
export * from "./host";
export * from "./runtime";
export * from "./registry";
