import { useState } from 'react'
import Form from '@rjsf/core'
import validator from '@rjsf/validator-ajv8'
import { SlidersHorizontal, Undo2 } from 'lucide-react'
import { MergePatch } from '@silo/shared/merge-patch'
import { Button } from '../../components/buttons/Button'
import { Pill } from '../../components/feedback/Pill'
import { slateFields, slateTemplates, slateWidgets } from '../../forms/theme'
import type { PluginView } from '../../api/types/plugin-view'
import styles from './PluginDetail.module.css'

/**
 * What the plugin is configured with (D39, phase 5).
 *
 * The form comes from the manifest's own JSON Schema, which D31 put there
 * saying exactly this would happen: carried at 1.0 "even though nothing renders
 * it, which is what lets the admin settings form arrive later through RJSF with
 * no manifest change". A plugin that declares no schema gets the JSON editor
 * instead, because a config silo cannot describe is still a config an operator
 * may need to change.
 *
 * What is sent is a **merge patch**, computed against the document currently in
 * force. Sending the edited document instead looks right and cannot express a
 * deletion, so a key the operator cleared would silently survive.
 */
export function PluginConfigCard({
  plugin,
  canConfigure,
  busy,
  onSave,
  onClear,
}: {
  plugin: PluginView
  canConfigure: boolean
  busy: boolean
  onSave: (patch: Record<string, unknown>) => void
  onClear: () => void
}) {
  const [draft, setDraft] = useState<Record<string, unknown>>(plugin.config)
  const [text, setText] = useState(() => JSON.stringify(plugin.config, null, 2))
  const [textError, setTextError] = useState('')

  const schema = plugin.config_schema as any
  const locked = !canConfigure || busy
  const overridden = plugin.config_source === 'store'

  const saveJson = () => {
    let parsed: unknown
    try {
      parsed = JSON.parse(text || '{}')
    } catch {
      setTextError('That is not valid JSON.')
      return
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      setTextError('A plugin config is a JSON object.')
      return
    }
    setTextError('')
    onSave(MergePatch.diff(plugin.config, parsed as Record<string, unknown>))
  }

  return (
    <section className={styles.card}>
      <div className={styles.cardHeader}>
        <div className={styles.sectionTitle}>
          <SlidersHorizontal size={16} />
          <h2>Configuration</h2>
          <Pill tone={overridden ? 'warn' : 'muted'}>
            {overridden ? 'overridden here' : 'from silo.toml'}
          </Pill>
        </div>
        <p>
          {overridden
            ? 'A stored override replaces the block in silo.toml whole. Clearing it is the way back to the file.'
            : 'Saving pins an override that replaces this plugin’s silo.toml block until it is cleared.'}
        </p>
      </div>

      {schema ? (
        <div className={styles.form}>
          <Form
            schema={schema}
            validator={validator}
            formData={draft}
            templates={slateTemplates as any}
            widgets={slateWidgets as any}
            fields={slateFields as any}
            showErrorList="top"
            disabled={locked}
            onChange={(event: any) => setDraft(event.formData ?? {})}
            onSubmit={(event: any) =>
              onSave(MergePatch.diff(plugin.config, (event.formData ?? {}) as Record<string, unknown>))
            }
          >
            {canConfigure && (
              <div className={styles.cardActions}>
                {overridden && (
                  <Button type="button" variant="secondary" disabled={busy} onClick={onClear}>
                    <Undo2 size={14} /> Use silo.toml
                  </Button>
                )}
                <Button type="submit" variant="primary" disabled={busy}>Save configuration</Button>
              </div>
            )}
          </Form>
        </div>
      ) : (
        <>
          <p className={styles.note}>
            {plugin.kind === null
              ? 'This plugin’s package could not be read, so there is no schema to render a form from.'
              : 'This plugin declares no config schema, so there is nothing to render a form from.'}
          </p>
          <textarea
            className="input mono"
            spellCheck={false}
            rows={8}
            value={text}
            disabled={locked}
            onChange={(event) => setText(event.target.value)}
          />
          {textError && <div className="field-error">{textError}</div>}
          {canConfigure && (
            <div className={styles.cardActions}>
              {overridden && (
                <Button variant="secondary" disabled={busy} onClick={onClear}>
                  <Undo2 size={14} /> Use silo.toml
                </Button>
              )}
              <Button variant="primary" disabled={busy} onClick={saveJson}>Save configuration</Button>
            </div>
          )}
        </>
      )}
    </section>
  )
}
