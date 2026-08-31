/**
 * Settings an operator changes through the API rather than by editing a file
 * (D45, D46, D47).
 *
 * One shape throughout, which is why the directory is named for it: a pure half
 * that decides which value wins, and a supervisor that writes one table of
 * `silo.toml` and applies what it can. `[blob_storage]` decides where the bytes
 * go; `[media]` decides where their URLs point and what the library takes in.
 * Those two are hand-written because each has a rule of its own — a write-only
 * secret, a base URL that must be absolute — and they live under `/api/media/`
 * because they belong to that page.
 *
 * The rest of the file is spec-driven instead (`ConfigSections`), because four
 * more hand-written pairs would be twelve files whose only real content is which
 * key carries which value and which variable beats it. `ConfigSupervisor` is
 * also the first that cannot always apply what it saves, and says so per field
 * rather than pretending.
 *
 * Import from `settings`, never a file inside.
 */
export type { MediaStorageFacts } from "./media-storage-facts";
export type { MediaStorageInput } from "./media-storage-input";
export type { SettingsOverride } from "./settings-override";
export type { MediaStorageView } from "./media-storage-view";
export { MediaStorageSettings } from "./media-storage-settings";
export { MediaStorageSupervisor } from "./media-storage-supervisor";
export type { MediaStorageSupervisorOptions } from "./media-storage-supervisor";
export type { MediaPolicyInput } from "./media-policy-input";
export type { MediaPolicyView } from "./media-policy-view";
export { MediaPolicySettings } from "./media-policy-settings";
export { MediaPolicySupervisor } from "./media-policy-supervisor";
export type { MediaPolicySupervisorOptions } from "./media-policy-supervisor";
export type { ConfigSectionView } from "./config-section-view";
export type { ConfigSettingsView } from "./config-settings-view";
export { ConfigSectionSettings } from "./config-section-settings";
export { ConfigSupervisor } from "./config-supervisor";
export type { ConfigSupervisorOptions } from "./config-supervisor";
