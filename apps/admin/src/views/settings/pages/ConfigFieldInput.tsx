import { Info, RotateCw } from 'lucide-react'
import { Toggle } from '../../../components/controls/Toggle'
import type { ConfigField, ConfigSectionView } from '../../../api/types/settings'
import settings from '../SettingsView.module.css'
import { ConfigSectionDraft, type ConfigSectionFields } from './config-section-draft'
import styles from './MediaStoragePage.module.css'

/**
 * One setting, drawn from its spec (D47).
 *
 * The server sends the type, the label and the restart behaviour, so adding a
 * setting to `ConfigSections` puts it on this page with nothing to change here.
 * That is the whole reason the spec travels: a form built from a list written
 * out again in the admin is a form that goes stale one release after somebody
 * adds a field to the server and not to it.
 */
export function ConfigFieldInput({
  section,
  field,
  draft,
  editable,
  onChange,
}: {
  section: ConfigSectionView
  field: ConfigField
  draft: ConfigSectionFields
  editable: boolean
  onChange: (key: string, value: string | number | boolean) => void
}) {
  const id = `setting-${section.table}-${field.key}`
  const value = draft[field.key]
  const enabled = editable && !field.readOnly
  const inUse = ConfigSectionDraft.inUse(section, field)

  return (
    <div className={settings.inputGroup}>
      <div className={styles.fieldHead}>
        <label htmlFor={id}>{field.label}</label>
        {inUse && (
          <span className={styles.note}>
            {inUse.restart ? <RotateCw size={12} /> : <Info size={12} />}
            <span>
              {inUse.restart ? 'Restart to apply. Running: ' : 'In use: '}
              {inUse.value}
              {inUse.env ? ` (from ${inUse.env})` : ''}
            </span>
          </span>
        )}
      </div>

      {field.type === 'boolean' ? (
        <div className={styles.toggleRow}>
          <Toggle
            on={value === true}
            disabled={!enabled}
            onChange={(next) => onChange(field.key, next)}
          />
          {field.help && <span className={styles.help}>{field.help}</span>}
        </div>
      ) : field.type === 'enum' ? (
        <>
          <select
            id={id}
            className={styles.select}
            value={String(value ?? '')}
            disabled={!enabled}
            onChange={(event) => onChange(field.key, event.target.value)}
          >
            {/* The file may say nothing, and that is not the same as the first
                option. An empty choice keeps "unset" reachable, so a section
                can be put back to following the defaults. */}
            <option value="">(default)</option>
            {(field.values ?? []).map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          {field.help && <span className={styles.help}>{field.help}</span>}
        </>
      ) : (
        <>
          <input
            id={id}
            type={field.type === 'number' ? 'number' : 'text'}
            value={value === undefined ? '' : String(value)}
            disabled={!enabled}
            min={field.min}
            placeholder={ConfigSectionDraft.inUse(section, field)?.value ?? ''}
            onChange={(event) =>
              onChange(
                field.key,
                field.type === 'number'
                  ? event.target.value === ''
                    ? ''
                    : Number(event.target.value)
                  : event.target.value,
              )
            }
          />
          {(field.help || field.zeroMeans) && (
            <span className={styles.help}>
              {field.help}
              {field.zeroMeans ? ` 0 means ${field.zeroMeans}.` : ''}
            </span>
          )}
        </>
      )}
    </div>
  )
}
