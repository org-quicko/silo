import { AlertTriangle, KeyRound } from 'lucide-react'
import type { KeyView } from '../../api/types/key-view'
import type { ScopeRef } from '../../api/types/scope-ref'
import { Button } from '../../components/buttons/Button'
import { Segmented } from '../../components/controls/Segmented'
import { Breadcrumb } from '../../components/navigation/Breadcrumb'
import { TopBar } from '../shell/TopBar'
import { AdvancedTab } from './AdvancedTab'
import { CustomTab } from './CustomTab'
import { KeyClaimDiff } from './KeyClaimDiff'
import { KeyReview } from './KeyReview'
import { KeySecret } from './KeySecret'
import type { KeyMode } from './key-mode'
import { PresetsTab } from './PresetsTab'
import { useKeyForm } from './use-key-form'
import styles from './KeyForm.module.css'

interface Props {
  url: string
  apiKey: string
  /** The settings scope, used only as the *default* reach — never as a hidden one. */
  scope: ScopeRef | null
  ownClaims: string[]
  /** The key being edited, or null when minting a new one. */
  subject: KeyView | null
  keysUrl: string
  onCancel: () => void
  onDone: () => void
}

const TABS: { value: KeyMode; label: string }[] = [
  { value: 'presets', label: 'Presets' },
  { value: 'advanced', label: 'Advanced' },
  { value: 'custom', label: 'Custom' },
]

/**
 * Create or edit an API key: what it is called, and what it may do.
 *
 * The claim list is written in one of three modes, and the tab strip under the
 * label is the only thing that chooses between them. Everything below the strip
 * composes the same list, and the review at the foot of the page reads that
 * list and nothing else — so whichever tab produced it, what you are about to
 * grant is described in one place, in the same words.
 */
export function KeyFormView({
  url,
  apiKey,
  scope,
  ownClaims,
  subject,
  keysUrl,
  onCancel,
  onDone,
}: Props) {
  const form = useKeyForm(url, apiKey, ownClaims, scope, subject, onDone)
  const editing = subject !== null

  if (form.created) {
    return (
      <>
        <TopBar />
        <div className="content">
          <Breadcrumb crumbs={[{ label: 'API keys', to: keysUrl }, { label: 'Key created' }]} />
          <div className={styles.wrap}>
            <KeySecret created={form.created} onDone={onDone} />
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <TopBar>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" onClick={form.submit} disabled={form.busy}>
          {form.busy
            ? editing
              ? 'Saving…'
              : 'Creating…'
            : editing
              ? 'Save changes'
              : 'Create key'}
        </Button>
      </TopBar>

      <div className="content">
        <Breadcrumb
          crumbs={[
            { label: 'API keys', to: keysUrl },
            { label: editing ? 'Edit key' : 'Create key' },
          ]}
        />
        <div className="page-head">
          <div className="page-title-group">
            <div className="page-title-row">
              <span className={styles.pageIcon}>
                <KeyRound size={19} />
              </span>
              <h2 className="page-title">{editing ? subject.label : 'Create an API key'}</h2>
            </div>
            <span className="page-sub">
              {editing
                ? 'The secret does not change. New claims apply to the key already in use.'
                : 'Claims are explicit and denied by default. The secret is shown once.'}
            </span>
          </div>
        </div>

        <div className={styles.wrap}>
          {form.error && (
            <div className="banner banner-bad">
              <span>{form.error}</span>
            </div>
          )}
          {form.editingSelf && (
            <div className="banner banner-warn">
              <AlertTriangle size={14} />
              <span>This is the key you are connected with. Narrowing it applies immediately.</span>
            </div>
          )}
          {form.catalog.projects.length === 0 && (
            <div className="banner banner-warn">
              <span>
                This server lists no projects, so only instance-wide and root keys can be scoped
                correctly.
              </span>
            </div>
          )}

          <section className={`card ${styles.section}`}>
            <div className="field">
              <label className="field-label">Label</label>
              <input
                className="input"
                autoFocus
                placeholder="e.g. web-frontend"
                value={form.label}
                onChange={(event) => form.setLabel(event.target.value)}
              />
              <span className="field-hint">Shown in the key list. It grants nothing.</span>
            </div>
          </section>

          <div className={styles.tabs}>
            <Segmented
              variant="tabs"
              value={form.mode}
              options={TABS}
              onChange={form.switchMode}
            />
            {form.modeError && <span className={styles.tabsError}>{form.modeError}</span>}
          </div>

          <section className={`card ${styles.section}`}>
            {form.mode === 'presets' && (
              <PresetsTab
                role={form.preset.role}
                scopes={form.preset.scopes}
                catalog={form.catalog}
                blocked={form.blockedRoles}
                onRole={(role) => form.setPreset({ ...form.preset, role })}
                onScopes={(scopes) => {
                  form.setScopeTouched(true)
                  form.setPreset({ ...form.preset, scopes })
                }}
              />
            )}
            {form.mode === 'advanced' && (
              <AdvancedTab
                plan={form.advanced}
                catalog={form.catalog}
                ownClaims={ownClaims}
                onChange={form.setAdvanced}
              />
            )}
            {form.mode === 'custom' && (
              <CustomTab
                text={form.customText}
                parsed={form.custom}
                catalog={form.catalog}
                onChange={form.setCustomText}
              />
            )}
          </section>

          {editing && <KeyClaimDiff added={form.diff.added} removed={form.diff.removed} />}

          <KeyReview
            claims={form.claims}
            scopeLabel={form.describeScope()}
            project={form.pillScope?.project}
            env={form.pillScope?.env}
            canDelegate={form.canDelegate}
          />
        </div>
      </div>
    </>
  )
}
