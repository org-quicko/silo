import type { PluginGrantRecord } from "../../core/plugins/plugin-grant-record";
import { PluginGrantUtils } from "../../core/plugins/plugin-grant-utils";

/** What `GET /api/plugins` returns per plugin (D38). */
export interface PluginView {
  name: string;
  state: PluginGrantRecord["state"];
  /** Absent `enabled` means enabled, but the wire form is explicit — a client
   *  reading `undefined` as false would show every plugin as off. */
  enabled: boolean;
  requested: string[];
  granted: string[];
  /**
   * `requested` minus `granted`, computed here rather than left to the client.
   *
   * It is the reviewable part of a grant — "approved everything" and "approved
   * two of nine" are different decisions — and a client that derived it would be
   * a second implementation of `Claims.has`, which is the wildcard-aware
   * comparison this repo keeps in exactly one place.
   */
  not_granted: string[];
  hooks: string[];
  /** The managed key carrying the grant. Its id only: the secret is host-side
   *  and exists nowhere a response could reach (D34). */
  key_id: string | null;
  granted_by: string | null;
  granted_at: string | null;
  /** The revision to send back as `If-Match` on a change. */
  rev: number;
}

export class PluginViews {
  static of(record: PluginGrantRecord): PluginView {
    return {
      name: record.name,
      state: record.state,
      enabled: record.enabled !== false,
      requested: record.requested,
      granted: record.granted,
      not_granted: PluginGrantUtils.missing(record.requested, record.granted),
      hooks: record.hooks,
      key_id: record.key_id ?? null,
      granted_by: record.granted_by,
      granted_at: record.granted_at ?? null,
      rev: record.rev,
    };
  }
}
