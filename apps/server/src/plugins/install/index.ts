/**
 * Installing a plugin (D32), the fifth submodule of `apps/server/src/plugins/`.
 *
 * `manifest/` reads what a plugin declares, `host/` executes it, `runtime/` is
 * what it can see, `registry/` wires it up — and this acquires it. It sits
 * *above* the other four and below nothing: `PluginInstaller` calls into
 * `ManifestReader` and `PluginLoader` to judge what it fetched, and nothing in
 * the load path calls back here. That direction is the whole reason an
 * installer could be added to a frozen contract without touching it.
 */
export { DirectoryFetcher } from "./directory-fetcher";
export { GitFetcher } from "./git-fetcher";
export { Integrity } from "./integrity";
export { NpmFetcher } from "./npm-fetcher";
export { NpmRegistry } from "./npm-registry";
export type { ResolvedRelease } from "./npm-registry";
export { PackageExtractor } from "./package-extractor";
export type { FetchedPackage, PackageFetcher } from "./package-fetcher";
export { PluginInstaller } from "./plugin-installer";
export type { InstallOptions, InstallResult } from "./plugin-installer";
export { PluginLock } from "./plugin-lock";
export type { LockEntry } from "./plugin-lock";
export type { PluginSource } from "./plugin-source";
export { SourceParser } from "./source-parser";
export { TarballDownload } from "./tarball-download";
export { TarballFetcher } from "./tarball-fetcher";
export { UrlFetcher } from "./url-fetcher";
