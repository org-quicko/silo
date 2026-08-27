/** Who made an authority change (D38). `cli` carries no id: the offline
 *  commands are bounded by filesystem access, not by a key. */
export interface AuditActor {
  kind: 'key' | 'cli' | 'system'
  id?: string
  /** The key's label at the time, kept so a revoked key's entries stay
   *  readable. */
  label?: string
}

/** One recorded authority change (D38). Authority only — entry writes are not
 *  in here, which is what keeps the trail short enough to read. */
export interface AuditEvent {
  at: string
  action:
    | 'key.create'
    | 'key.revoke'
    | 'plugin.grant'
    | 'plugin.revoke'
    | 'plugin.uninstall'
    | 'plugin.enable'
    | 'plugin.disable'
    | 'plugin.configure'
  actor: AuditActor
  /** A `_keys` id for `key.*`, a plugin name for `plugin.*`. */
  subject: string
  detail: Record<string, unknown>
}
