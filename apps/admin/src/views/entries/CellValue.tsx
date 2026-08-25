import { Check, ExternalLink, File, Image as ImageIcon } from 'lucide-react'
import { MediaRef } from '@silo/shared/media-ref'
import { StatusPill } from '../../components/feedback/StatusPill'
import { ValueTitle } from '../../utils/value-title'
import { Formatters } from '../../utils/formatters'
import type { MediaAsset } from '../../api/types/media-asset'
import { CellFormat } from './cell-format'

import styles from './CellValue.module.css'

// summary names a value the cell can't show the inside of. String(value) on an
// object renders "[object Object]", which a reference list turned into a row of
// them, so objects are labelled by their first filled field — the same rule the
// entry form's collapsed array items use.
function summary(schema: any, value: any): string {
  return ValueTitle.of(schema, undefined, value) ?? '{…}'
}

/**
 * One table cell, rendered by the property's JSON Schema type (handoff 1e).
 * Three rules hold for every branch below: one line, always; absent is `—`
 * regardless of whether the value was missing, `null`, or `""`; and nothing
 * here ever prints a raw object — a cell shows a summary or a count, never a
 * dump.
 *
 * `mediaById` resolves an `x-silo-type: media` reference into a filename and
 * thumbnail; without an entry for the id (not yet fetched, or dangling) the
 * cell falls back to a short id rather than ever showing the stored
 * `silo://media/<ulid>` itself.
 */
export function CellValue({
  schema,
  name,
  value,
  mediaById,
}: {
  schema: any
  name: string
  value: any
  mediaById?: Record<string, MediaAsset>
}) {
  const prop = schema?.properties?.[name]
  if (value == null || value === '') return <span className="muted">—</span>

  if (CellFormat.isMediaField(prop) && typeof value === 'string') {
    return <MediaCell value={value} assets={mediaById} />
  }

  if (prop?.enum && typeof value === 'string') return <StatusPill value={value} />

  if (typeof value === 'string' && prop?.format === 'uri') {
    return (
      <span className={styles.uri}>
        <ExternalLink size={12} />
        <span className={styles.text}>{CellFormat.formatUri(value)}</span>
      </span>
    )
  }

  if (typeof value === 'string' && prop?.format === 'date-time') {
    return (
      <span className={styles.date} title={value}>
        {CellFormat.smartDate(value)}
      </span>
    )
  }

  if (typeof value === 'number') {
    return <span className={styles.number}>{CellFormat.formatNumber(value, prop?.multipleOf)}</span>
  }

  if (typeof value === 'boolean') {
    return value ? <Check size={15} className={styles.boolTrue} aria-label="true" /> : <span className={styles.boolFalse} aria-label="false" />
  }

  if (Array.isArray(value)) {
    // An array of objects has nothing summarisable in one line — a count is
    // the only honest rendering, never a preview of the first item.
    if (value.length > 0 && typeof value[0] === 'object' && value[0] !== null) {
      return <span className={styles.countPill}>{value.length} item{value.length === 1 ? '' : 's'}</span>
    }
    const shown = value.slice(0, 2)
    return (
      <span className={styles.tags}>
        {shown.map((v, i) => (
          <span key={i} className={styles.chip} title={summary(prop?.items, v)}>
            {summary(prop?.items, v)}
          </span>
        ))}
        {value.length > 2 && <span className={styles.more}>+{value.length - 2}</span>}
      </span>
    )
  }

  if (typeof value === 'object') {
    const branch = CellFormat.matchBranch(prop, value)
    if (branch) return <span className={styles.chip}>{branch}</span>
    const keys = Object.keys(value)
    return <span className={styles.object}>{`{ ${keys.length} key${keys.length === 1 ? '' : 's'} }`}</span>
  }

  // Body text is dimmed (handoff 1e): it is here as evidence the field is
  // filled, not to be read a line at a time, and at full strength it out-shouts
  // the short values either side of it.
  if (typeof value === 'string' && CellFormat.isLongText(prop, value)) {
    return <span className={`${styles.text} ${styles.longText}`} title={value}>{value}</span>
  }

  return <span className={styles.text}>{String(value)}</span>
}

function MediaCell({ value, assets }: { value: string; assets?: Record<string, MediaAsset> }) {
  const id = MediaRef.canonicalId(value)
  const asset = id ? assets?.[id] : undefined

  if (!asset) {
    return (
      <span className={styles.media}>
        <span className={styles.mediaFallback}>
          <ImageIcon size={13} />
        </span>
        <span className={styles.text}>{id ? Formatters.shortId(id) : '—'}</span>
      </span>
    )
  }

  const isImage = asset.content_type.startsWith('image/')
  return (
    <span className={styles.media} title={asset.filename}>
      {isImage ? (
        <img className={styles.mediaThumb} src={asset.url} alt="" />
      ) : (
        <span className={styles.mediaFallback}>
          <File size={13} />
        </span>
      )}
      <span className={styles.text}>{asset.filename}</span>
    </span>
  )
}
