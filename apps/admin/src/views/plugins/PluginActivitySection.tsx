import { useEffect, useState } from 'react'
import { api } from '../../api/silo-api'
import { Formatters } from '../../utils/formatters'
import type { AuditEvent } from '../../api/types/audit-event'
import styles from './PluginDetail.module.css'

/** What each recorded decision was, in words. Only authority changes are in
 *  the trail — entry writes are what `rev` and `updated_at` already are. */
const ACTION_TEXT: Record<AuditEvent['action'], string> = {
  'key.create': 'minted the managed key',
  'key.revoke': 'revoked the managed key',
  'plugin.grant': 'approved a grant',
  'plugin.revoke': 'withdrew the grant',
  'plugin.uninstall': 'uninstalled it',
  'plugin.enable': 'enabled it',
  'plugin.disable': 'disabled it',
  'plugin.configure': 'changed its configuration',
}

/** `cli` carries no id on purpose: the offline commands are bounded by
 *  filesystem access rather than by a key, so there is nothing to name. */
function actorLabel(actor: AuditEvent['actor']): string {
  if (actor.kind === 'cli') return 'the silo CLI'
  if (actor.kind === 'system') return 'silo'
  return actor.label || actor.id || 'a key'
}

function list(value: unknown, empty: string): string {
  return Array.isArray(value) && value.length > 0 ? (value as string[]).join(' · ') : empty
}

/**
 * The part of an event worth reading, per action.
 *
 * Per action rather than one field name, because each carries a different one:
 * a grant records what was `granted`, a revocation what was `withdrawn`, and a
 * config change only the **keys** that moved — never the values, since a
 * config is where a plugin's own credentials live. Reading a single field
 * across all of them is how this rendered nothing at all for the one action it
 * matters most for, which is what running it showed.
 */
const DETAIL: Partial<Record<AuditEvent['action'], (detail: Record<string, unknown>) => string>> = {
  'plugin.grant': (detail) => list(detail.granted, 'nothing'),
  'plugin.revoke': (detail) => list(detail.withdrawn, 'nothing'),
  'plugin.uninstall': (detail) => list(detail.withdrawn, 'nothing'),
  'plugin.configure': (detail) =>
    detail.cleared === true ? 'back to silo.toml' : list(detail.keys, 'no settings'),
  'key.create': (detail) => list(detail.claims, 'nothing'),
  'key.revoke': (detail) => (typeof detail.reason === 'string' ? detail.reason : ''),
}

/**
 * Who changed what, for this plugin (D38).
 *
 * Behind `audit:read`, and absent rather than empty when the current key does
 * not hold it — an empty trail and a trail you may not read are different
 * facts, and showing the first for the second would be a lie about the
 * instance.
 */
export function PluginActivitySection({
  url,
  apiKey,
  name,
  rev,
}: {
  url: string
  apiKey: string
  name: string
  /** Re-reads the trail whenever the record changes, so an action taken on
   *  this page appears in it without a reload. */
  rev: number
}) {
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    api.audit
      .list(url, apiKey, { subject: name, limit: 20 })
      .then((page) => live && setEvents(page.items))
      .catch((caught: any) => live && setError(caught.message || 'Failed to read the audit trail.'))
    return () => {
      live = false
    }
  }, [url, apiKey, name, rev])

  // No lead paragraph: the sheet's own subtitle says what this list is, and a
  // second sentence restating it in different words is what a section header
  // becomes when it is moved into a container that already has one.
  return (
    <div className={styles.section}>

      {error && <div className="banner banner-bad"><span>{error}</span></div>}

      {!error && events.length === 0 ? (
        <p className={styles.empty}>Nothing has been decided about this plugin yet.</p>
      ) : (
        <ol className={styles.trail}>
          {events.map((event) => {
            const detail = DETAIL[event.action]?.(event.detail) ?? ''
            return (
              <li key={`${event.at}-${event.action}`} className={styles.trailItem}>
                <span className={styles.trailWhen} title={event.at}>
                  {Formatters.relativeTime(event.at)}
                </span>
                <span className={styles.trailWhat}>
                  <b>{actorLabel(event.actor)}</b> {ACTION_TEXT[event.action] ?? event.action}
                </span>
                {detail && <span className={styles.trailDetail}>{detail}</span>}
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
