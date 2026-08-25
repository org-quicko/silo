/**
 * The plugin system (D31/§13).
 *
 * Five submodules, each with one job: `manifest/` reads and validates what a
 * plugin declares without running it, `host/` executes plugin code behind the
 * `PluginHost` port, `runtime/` is what a running plugin can see and do,
 * `registry/` is the single explicit wiring site, and `install/` (D32) is how
 * a plugin gets onto the disk.
 *
 * The dependency direction is one-way: `install/` reads the other four and
 * none of them reads it, which is what keeps an installer additive to a frozen
 * contract.
 *
 * Import from here, not from a file inside — the internal layout is ours to
 * change. The surface a plugin *itself* sees is `silo:api`, and that is frozen.
 */
export * from "./manifest";
export * from "./host";
export * from "./runtime";
export * from "./registry";
export * from "./install";
