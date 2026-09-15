import type { AuditActor } from "../audit/audit-actor";

/**
 * The fields an edit may change on an existing key (D63), and who is changing
 * them.
 *
 * Both are optional and independent, so an edit that only renames sends only
 * `label` and the claim list is not rewritten — which matters because
 * rewriting it would bump `rev` and write a `key.update` event saying nothing
 * changed. Everything absent here is deliberately unreachable: `hash`,
 * `prefix`, `owner` and `parent_id` are the key's identity and its lineage, and
 * an edit that could move any of them would be a way to mint a credential
 * without minting one.
 */
export interface KeyEdit {
  /** The new label. Trimmed; an empty or blank string is refused rather than
   *  silently replaced, since the caller clearly meant to send something. */
  label?: string;
  /** The new claim list, replacing the old one outright — never merged. A
   *  merge would make removing a claim impossible to express. */
  claims?: string[];
  /** Who is editing, for the trail. Absent is recorded as `system`, which is
   *  the honest answer for the offline CLI path. */
  actor?: AuditActor;
}
