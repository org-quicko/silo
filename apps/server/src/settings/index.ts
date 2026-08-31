/**
 * Settings an operator changes through the API rather than by editing a file
 * (D45, D46).
 *
 * Two subjects, one shape, which is why the directory is named for the shape:
 * a pure half that decides which value wins, and a supervisor that writes one
 * table of `silo.toml` and applies the result live. `[blob_storage]` decides
 * where the bytes go; `[media]` decides where their URLs point and what the
 * library takes in. Separate tables, separate routes and separate saves,
 * because changing an allowlist should not have to re-open a bucket.
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
