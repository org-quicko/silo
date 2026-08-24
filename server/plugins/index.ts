/**
 * The plugin system (D31/§13).
 *
 * Five submodules, each with one job: `manifest/` reads and validates what a
 * plugin declares without running it, `host/` executes plugin code behind the
 * `PluginHost` port, `runtime/` is what a running plugin can see and do,
 * `registry/` is the single explicit wiring site everything else goes through,
 * and `install/` (D32) is how a plugin gets onto the disk in the first place.
 *
 * `install/` is deliberately the only one the load path never calls: it
 * depends on `manifest/` and `registry/` to judge what it fetched, and nothing
 * depends on it. An installer that the loader had to know about would have
 * been a change to the contract §13 froze; this one is not.
 *
 * Import from here, not from a file inside — the internal layout is ours to
 * change, and the surface a plugin's *host* presents is not the same thing as
 * the surface a plugin sees (that one is `silo:api`, and it is frozen).
 */
export * from "./manifest";
export * from "./host";
export * from "./runtime";
export * from "./registry";
export * from "./install";
