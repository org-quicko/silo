import { useState, type FormEvent } from 'react'
import { AlertTriangle, RotateCw } from 'lucide-react'
import { Button } from '../../../components/buttons/Button'
import type { ConfigSectionView } from '../../../api/types/settings'
import { SettingsSection } from '../parts/SettingsSection'
import ledger from '../parts/SettingsLedger.module.css'
import settings from '../SettingsView.module.css'
import { ConfigFieldInput } from './ConfigFieldInput'
import { ConfigSectionDraft, type ConfigSectionFields } from './config-section-draft'

/**
 * One `[table]` of `silo.toml`, with its own Save (D47).
 *
 * Per section rather than one Save for the page, following the two media
 * cards: a value `[search]` rejects must not stop a `[log]` level being
 * corrected, and a section that saved its neighbours' unsaved edits along with
 * its own would be a surprise nobody asked for.
 *
 * The draft is local to the section for the same reason. It is reset from the
 * view on every save, so what the boxes hold after one is exactly what the file
 * now says rather than what was typed into it.
 */
export function ConfigSectionCard({
  section,
  onSave,
}: {
  section: ConfigSectionView
  onSave: (table: string, input: Record<string, unknown>) => Promise<void>
}) {
  const [draft, setDraft] = useState<ConfigSectionFields>(() => ConfigSectionDraft.of(section))
  const [seed, setSeed] = useState(() => JSON.stringify(section.file))
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  // Re-seed when the server's answer changes under us — a save on another card
  // returns the whole view, and this one must not keep showing the old file.
  const current = JSON.stringify(section.file)
  if (current !== seed) {
    setSeed(current)
    setDraft(ConfigSectionDraft.of(section))
    setSaved(false)
  }

  const editable = section.writable && !saving
  const dirty = ConfigSectionDraft.changed(draft, section)

  const save = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    setSaved(false)
    setSaving(true)
    try {
      await onSave(section.table, ConfigSectionDraft.payload(draft, section))
      setSaved(true)
    } catch (failure: any) {
      setError(failure.message || 'The settings could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={save}>
      <SettingsSection title={section.title}>
        {section.fields.map((field) => (
          <ConfigFieldInput
            key={field.key}
            section={section}
            field={field}
            draft={draft}
            editable={editable}
            onChange={(key, value) => {
              setSaved(false)
              setDraft((held) => ({ ...held, [key]: value }))
            }}
          />
        ))}

        {error && (
          <div className={settings.alertError}>
            <AlertTriangle size={15} />
            <span>{error}</span>
          </div>
        )}

        {(section.writable || section.restart_pending.length > 0) && (
          <div className={ledger.sectionActions}>
            {section.restart_pending.length > 0 ? (
              <span className={`${ledger.sectionNote} ${ledger.noteWarn}`}>
                <RotateCw size={12} /> Waiting for a restart:{' '}
                {section.restart_pending.join(', ')}
              </span>
            ) : saved && !error ? (
              <span className={`${ledger.sectionNote} ${ledger.noteOk}`}>Saved</span>
            ) : null}

            {section.writable && (
              <Button type="submit" variant="primary" disabled={!editable || !dirty}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
            )}
          </div>
        )}
      </SettingsSection>
    </form>
  )
}
