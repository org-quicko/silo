import type { PluginGrant } from "./plugin-grant";

/**
 * A stored grant plus the revision that stored it (D38).
 *
 * `PluginGrant` is what goes in the `_plugins` document; `rev` lives on the
 * envelope around it. The management API needs both — the record to render and
 * the revision to send back as `ETag` — so the pair is named once here rather
 * than returned as a tuple that every caller destructures differently.
 */
export interface PluginGrantRecord extends PluginGrant {
  rev: number;
}
