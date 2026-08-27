/**
 * One claim a package asks for, and why (D36).
 *
 * The `reason` is required, and it is the field the whole split exists for. An
 * operator approving `collections:*&#47;*&#47;*:entries:delete` deserves to read what
 * the author says it is for, in the author's words, at the moment of deciding —
 * and a manifest field is the one thing that cannot be added once 1.0 has frozen
 * the manifest. It is carried for the same reason D31 carried `config` before
 * anything rendered it.
 *
 * It is documentation and not authority: nothing enforces that a plugin uses a
 * claim for the reason it gave, and the reason is deliberately **not** part of the
 * manifest digest, so fixing a typo in one does not re-prompt for a decision
 * nobody changed.
 */
export interface PluginPermission {
  claim: string;
  reason: string;
}
