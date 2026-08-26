import { useState } from 'react'
import { ChevronDown, ChevronRight, Code2, KeyRound } from 'lucide-react'
import { Claims } from '@silo/shared/claims'
import type { ScopeRef } from '../../api/types/scope-ref'
import { Button } from '../../components/buttons/Button'
import { Breadcrumb } from '../../components/navigation/Breadcrumb'
import { TopBar } from '../shell/TopBar'
import { CollectionPicker } from './CollectionPicker'
import { KeyRoles } from './key-roles'
import { NewKeyCapabilities } from './NewKeyCapabilities'
import { NewKeyReach } from './NewKeyReach'
import { NewKeyReview } from './NewKeyReview'
import { NewKeySecret } from './NewKeySecret'
import { RawClaimsEditor } from './RawClaimsEditor'
import { useNewKeyForm } from './use-new-key-form'
import styles from './NewKey.module.css'

interface Props {
  url: string
  apiKey: string
  /** The settings scope, used only as the *default* reach — never as a hidden one. */
  scope: ScopeRef | null
  ownClaims: string[]
  projects: string[]
  keysUrl: string
  onCancel: () => void
  onDone: () => void
}

/**
 * Create an API key: who it is, what it can reach, and what it can do there.
 *
 * The page is one guided sentence — label, reach, role — with everything else
 * behind Advanced, because the overwhelmingly common key is a single role over
 * a single scope. Advanced adds what the sentence cannot say: narrowing to
 * named collections, the instance capabilities, and a raw claim editor that
 * takes over when even those are not enough.
 */
export function NewKeyView({
  url,
  apiKey,
  scope,
  ownClaims,
  projects,
  keysUrl,
  onCancel,
  onDone,
}: Props) {
  const form = useNewKeyForm(url, apiKey, ownClaims, scope)
  const [advancedOpen, setAdvancedOpen] = useState(false)

  if (form.created) {
    return (
      <>
        <TopBar />
        <div className="content">
          <Breadcrumb crumbs={[{ label: 'API keys', to: keysUrl }, { label: 'Key created' }]} />
          <div className={styles.wrap}>
            <NewKeySecret created={form.created} onDone={onDone} />
          </div>
        </div>
      </>
    )
  }

  // The raw editor takes over: the guided controls are paused while it is open.
  const guidedDisabled = !!form.raw

  return (
    <>
      <TopBar>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" onClick={form.submit} disabled={form.busy}>
          {form.busy ? 'Creating…' : 'Create key'}
        </Button>
      </TopBar>

      <div className="content">
        <Breadcrumb crumbs={[{ label: 'API keys', to: keysUrl }, { label: 'Create key' }]} />
        <div className="page-head">
          <div className="page-title-group">
            <div className="page-title-row">
              <span className={styles.pageIcon}>
                <KeyRound size={19} />
              </span>
              <h2 className="page-title">Create an API key</h2>
            </div>
            <span className="page-sub">
              Claims are explicit and denied by default. The secret is shown once.
            </span>
          </div>
        </div>

        <div className={styles.wrap}>
          {form.error && (
            <div className="banner banner-bad">
              <span>{form.error}</span>
            </div>
          )}
          {projects.length === 0 && (
            <div className="banner banner-warn">
              <span>
                This server lists no projects, so only instance-wide and root keys can be
                scoped correctly.
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

          <fieldset
            className={`card ${styles.section} ${guidedDisabled ? styles.sectionMuted : ''}`}
            disabled={guidedDisabled}
          >
            <div className={styles.sectionHeader}>
              <div>
                <h3>Can reach</h3>
                <p>Which project and environment this key&apos;s collection claims target.</p>
              </div>
            </div>
            {form.role === 'root' ? (
              <p className={styles.rootNote}>
                A root key ignores reach — it covers every project and environment.
              </p>
            ) : (
              <NewKeyReach
                reach={form.reach}
                project={form.project}
                env={form.env}
                projects={projects}
                environments={form.environments}
                loadingEnvironments={form.loadingEnvironments}
                blocked={form.blockedReaches}
                onChange={form.changeReach}
              />
            )}
          </fieldset>

          <fieldset
            className={`card ${styles.section} ${guidedDisabled ? styles.sectionMuted : ''}`}
            disabled={guidedDisabled}
          >
            <div className={styles.sectionHeader}>
              <div>
                <h3>Can do</h3>
                <p>Each role includes everything the one before it grants.</p>
              </div>
            </div>
            <div className={styles.roles}>
              {KeyRoles.All.map((option) => {
                const blocked = form.roleBlocked(option.value)
                return (
                  <button
                    key={option.value}
                    type="button"
                    className={`${styles.role} ${form.role === option.value ? styles.roleActive : ''} ${option.value === 'root' ? styles.roleRoot : ''}`}
                    disabled={blocked}
                    title={blocked ? 'The current key cannot delegate this role.' : undefined}
                    onClick={() => form.changeRole(option.value)}
                  >
                    <b>{option.label}</b>
                    <span>{option.blurb}</span>
                  </button>
                )
              })}
            </div>
          </fieldset>

          <section className={`card ${styles.section} ${styles.advanced}`}>
            <button
              type="button"
              className={styles.advancedToggle}
              onClick={() => setAdvancedOpen(!advancedOpen)}
            >
              {advancedOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
              <span>
                <b>Advanced</b>
                <small>
                  Narrow to named collections, add instance capabilities, or write claims by
                  hand.
                </small>
              </span>
            </button>

            {advancedOpen && (
              <div className={styles.advancedBody}>
                {form.raw ? (
                  <RawClaimsEditor
                    text={form.rawText ?? ''}
                    parsed={form.raw}
                    onChange={form.setRawText}
                    onReturnToGuided={() => form.setRawText(null)}
                  />
                ) : (
                  <>
                    {form.canNarrow && (
                      <CollectionPicker
                        scopeLabel={`${form.project}/${form.env}`}
                        collections={form.collections}
                        selected={form.selected}
                        narrowed={form.narrowed}
                        onNarrow={form.setNarrowed}
                        onToggle={form.toggleCollection}
                      />
                    )}

                    {form.role !== 'root' && (
                      <NewKeyCapabilities
                        capabilities={form.capabilities}
                        transferReplace={form.transferReplace}
                        ownClaims={ownClaims}
                        onToggle={form.toggleCapability}
                        onTransferReplace={form.setTransferReplace}
                      />
                    )}

                    <div className={styles.rawEntry}>
                      <div>
                        <b>Not expressible above?</b>
                        <span>
                          Edit the claim list by hand, seeded with what the controls produced.
                        </span>
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => form.setRawText(form.requestedClaims.join('\n'))}
                      >
                        <Code2 size={13} /> Edit claims directly
                      </Button>
                    </div>
                  </>
                )}
              </div>
            )}
          </section>

          <NewKeyReview
            claims={form.requestedClaims}
            scopeLabel={
              form.role === 'root' && !form.raw
                ? 'every project / every environment'
                : form.describeScope()
            }
            project={
              form.planScope.project === Claims.Root ? undefined : form.planScope.project
            }
            env={form.planScope.env === Claims.Root ? undefined : form.planScope.env}
            canDelegate={form.canDelegate}
          />
        </div>
      </div>
    </>
  )
}
