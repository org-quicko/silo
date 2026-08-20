import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Code2, KeyRound, Search, Undo2 } from 'lucide-react'
import { Claims } from '@silo/shared/claims'
import type { Claim } from '@silo/shared/claim'
import type { ClaimPreset } from '@silo/shared/claim-preset'
import { api } from '../../api/api-client'
import type { CreatedKey } from '../../api/types/created-key'
import type { ScopeRef } from '../../api/types/scope-ref'
import { Button } from '../../components/Button'
import { TopBar } from '../shell/TopBar'
import type { SessionBadge } from '../shell/session-badge'
import type { KeyReach } from './key-reach'
import { NewKeyCapabilities } from './NewKeyCapabilities'
import { NewKeyPlan, type NewKeyPlanInput } from './new-key-plan'
import { NewKeyReach } from './NewKeyReach'
import { NewKeyReview } from './NewKeyReview'
import { NewKeySecret } from './NewKeySecret'
import styles from './NewKey.module.css'

const ROLES: { value: ClaimPreset; label: string; blurb: string }[] = [
  { value: 'read', label: 'Read', blurb: 'Read schemas and entries, and list media.' },
  { value: 'write', label: 'Read & write', blurb: 'Everything Read can do, plus creating, updating and deleting entries and media.' },
  { value: 'manage', label: 'Manage', blurb: 'Everything Read & write can do, plus creating collections, editing schemas, changing public access, and deleting collections.' },
  { value: 'root', label: 'Root', blurb: 'Unrestricted. Ignores the reach above and covers keys, media and data transfer across the whole instance.' },
]

const MEDIA_CLAIMS: Claim[] = [Claims.MediaRead, Claims.MediaCreate, Claims.MediaDelete]

/**
 * Create an API key: who it is, what it can reach, and what it can do there.
 *
 * The page is one guided sentence — label, reach, role — with everything else
 * behind Advanced, because the overwhelmingly common key is a single role over
 * a single scope and the previous Standard/Custom split made that case pay for
 * the rare one. Advanced adds the parts the sentence cannot say: narrowing to
 * named collections, the instance capabilities, and a raw claim editor that
 * takes over when even those are not enough. The raw editor is why the guided
 * layer is allowed to stay small.
 */
export function NewKeyView({
  url,
  apiKey,
  scope,
  ownClaims,
  projects,
  session,
  keysUrl,
  onCancel,
  onDone,
}: {
  url: string
  apiKey: string
  /** The settings scope, used only as the *default* reach — never as a hidden one. */
  scope: ScopeRef | null
  ownClaims: string[]
  projects: string[]
  session: SessionBadge
  keysUrl: string
  onCancel: () => void
  onDone: () => void
}) {
  const [label, setLabel] = useState('')
  const [reach, setReach] = useState<KeyReach>('env')
  const [project, setProject] = useState(scope?.project ?? '')
  const [env, setEnv] = useState(scope?.env ?? '')
  const [role, setRole] = useState<ClaimPreset>('read')
  const [narrowed, setNarrowed] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [capabilities, setCapabilities] = useState<Claim[]>(() => [...Claims.presetFixedClaims('read')])
  const [transferReplace, setTransferReplace] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [rawText, setRawText] = useState<string | null>(null)
  const [scopeTouched, setScopeTouched] = useState(false)
  const [environments, setEnvironments] = useState<string[]>([])
  const [loadingEnvironments, setLoadingEnvironments] = useState(false)
  const [collections, setCollections] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<CreatedKey | null>(null)

  // The settings scope resolves over two round trips (projects, then that
  // project's environments), so it is still null on first paint and cannot be
  // read once into `useState`. It seeds the reach the moment it arrives, and
  // stops mattering as soon as the user picks for themselves.
  useEffect(() => {
    if (scopeTouched || !scope) return
    setProject(scope.project)
    setEnv(scope.env)
  }, [scope?.project, scope?.env, scopeTouched])

  // The reach's project drives its own env list, which is not necessarily the
  // settings scope's — the whole point of the picker is that a key can be
  // minted for a project you are not currently working in.
  useEffect(() => {
    let alive = true
    if (!project) {
      setEnvironments([])
      return
    }
    setLoadingEnvironments(true)
    api.listEnvironments(url, apiKey, project)
      .then((items) => {
        if (!alive) return
        setEnvironments(items)
        setEnv((current) => (items.includes(current) ? current : items[0] ?? ''))
      })
      .catch(() => {
        if (alive) setEnvironments([])
      })
      .finally(() => {
        if (alive) setLoadingEnvironments(false)
      })
    return () => {
      alive = false
    }
  }, [url, apiKey, project])

  // Only a reach naming one concrete environment can be narrowed to named
  // collections, so that is the only case worth listing them for.
  useEffect(() => {
    let alive = true
    if (reach !== 'env' || !project || !env) {
      setCollections([])
      return
    }
    api.listCollections(url, apiKey, { project, env })
      .then((items) => {
        if (alive) setCollections(items.map((item) => item.name))
      })
      .catch(() => {
        if (alive) setCollections([])
      })
    return () => {
      alive = false
    }
  }, [url, apiKey, project, env, reach])

  const input: NewKeyPlanInput = {
    reach,
    project,
    env,
    role,
    collections: narrowed ? selected : [],
    capabilities,
    transferReplace,
  }

  // Composition is a handful of string joins over a bounded permission list,
  // so it runs on every render rather than carrying a memo whose dependency
  // list would have to restate the whole form.
  const guidedClaims = NewKeyPlan.compose(input)

  const raw = useMemo(() => {
    if (rawText === null) return null
    const tokens = rawText.split(/[\s,]+/).map((token) => token.trim()).filter(Boolean)
    try {
      return { claims: Claims.normalize(tokens), error: '' }
    } catch (caught: any) {
      return { claims: [] as Claim[], error: caught.message || 'Invalid claim' }
    }
  }, [rawText])

  const requestedClaims = raw ? raw.claims : guidedClaims
  const canDelegate = Claims.canDelegate(ownClaims, requestedClaims)
  const planScope = NewKeyPlan.scope(input)
  const canNarrow = NewKeyPlan.canNarrow(input)
  const visibleCollections = collections.filter((name) => name.includes(query.trim().toLowerCase()))

  // Delegation shapes the controls rather than only the error at the bottom:
  // an option the current key could never grant is never offered. Both probes
  // drop `capabilities`, so an undelegatable instance capability greys out its
  // own toggle in Advanced (where the reason is legible) rather than every
  // reach and role at once.
  const collectionsOnly = { capabilities: [], collections: [] }
  const blockedReaches: Partial<Record<KeyReach, string>> = {}
  for (const candidate of ['env', 'project', 'env-all-projects', 'instance'] as KeyReach[]) {
    const probe = NewKeyPlan.probe(input, { ...collectionsOnly, reach: candidate })
    if (!Claims.canDelegate(ownClaims, probe)) {
      blockedReaches[candidate] = `The current key holds no ${ROLES.find((option) => option.value === role)!.label.toLowerCase()} authority that wide.`
    }
  }
  const roleBlocked = (candidate: ClaimPreset): boolean =>
    !Claims.canDelegate(ownClaims, NewKeyPlan.probe(input, { ...collectionsOnly, role: candidate }))

  const changeRole = (next: ClaimPreset) => {
    setRole(next)
    // The preset's media grant is surfaced in Advanced as real, editable
    // toggles instead of arriving invisibly with the preset. Choices outside
    // media (keys, transfer) are the user's and survive a role change.
    setCapabilities((current) =>
      Claims.normalize([
        ...Claims.presetFixedClaims(next).filter((claim) => Claims.has(ownClaims, claim)),
        ...current.filter((claim) => !MEDIA_CLAIMS.includes(claim)),
      ]),
    )
  }

  const changeReach = (patch: { reach?: KeyReach; project?: string; env?: string }) => {
    if (patch.project !== undefined || patch.env !== undefined) setScopeTouched(true)
    if (patch.reach !== undefined) setReach(patch.reach)
    if (patch.project !== undefined) setProject(patch.project)
    if (patch.env !== undefined) setEnv(patch.env)
    // A collection list belongs to the scope it was drawn from; carrying the
    // selection across a reach change would silently target a different one.
    if (patch.reach !== undefined || patch.project !== undefined || patch.env !== undefined) {
      setSelected([])
      setNarrowed(false)
    }
  }

  const toggleCapability = (claim: Claim) => {
    setCapabilities(capabilities.includes(claim)
      ? capabilities.filter((item) => item !== claim)
      : Claims.normalize([...capabilities, claim]))
  }

  const toggleCollection = (name: string) => {
    setSelected(selected.includes(name) ? selected.filter((item) => item !== name) : [...selected, name])
  }

  const submit = async () => {
    if (!label.trim()) return setError('A label is required.')
    if (raw?.error) return setError(raw.error)
    if (role !== 'root' && !raw) {
      if ((reach === 'env' || reach === 'project') && !project) return setError('Choose a project.')
      if ((reach === 'env' || reach === 'env-all-projects') && !env) return setError('Choose an environment.')
      if (reach === 'env-all-projects' && !Claims.isScopeId(env)) {
        return setError(`"${env}" is not a valid environment id.`)
      }
      if (narrowed && selected.length === 0) return setError('Select at least one collection, or widen to all collections.')
    }
    if (requestedClaims.length === 0) return setError('Select at least one claim.')
    if (!canDelegate) return setError('The current key cannot delegate one or more selected claims.')
    setBusy(true)
    setError('')
    try {
      setCreated(await api.createKey(url, apiKey, label.trim(), requestedClaims))
    } catch (caught: any) {
      setError(caught.message || 'Failed to create key')
    } finally {
      setBusy(false)
    }
  }

  if (created) {
    return (
      <>
        <TopBar crumbs={[{ label: 'API keys', to: keysUrl }, { label: 'Key created' }]} session={session} />
        <div className="content">
          <div className={styles.wrap}>
            <NewKeySecret created={created} onDone={onDone} />
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <TopBar crumbs={[{ label: 'API keys', to: keysUrl }, { label: 'Create key' }]} session={session}>
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button variant="primary" onClick={submit} disabled={busy}>{busy ? 'Creating…' : 'Create key'}</Button>
      </TopBar>

      <div className="content">
        <div className="page-head">
          <div className="page-title-group">
            <div className="page-title-row">
              <span className={styles.pageIcon}><KeyRound size={19} /></span>
              <h2 className="page-title">Create an API key</h2>
            </div>
            <span className="page-sub">Claims are explicit and denied by default. The secret is shown once.</span>
          </div>
        </div>

        <div className={styles.wrap}>
          {error && <div className="banner banner-bad"><span>{error}</span></div>}
          {projects.length === 0 && (
            <div className="banner banner-warn"><span>This server lists no projects, so only instance-wide and root keys can be scoped correctly.</span></div>
          )}

          <section className={`card ${styles.section}`}>
            <div className="field">
              <label className="field-label">Label</label>
              <input
                className="input"
                autoFocus
                placeholder="e.g. web-frontend"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
              />
              <span className="field-hint">Shown in the key list. It grants nothing.</span>
            </div>
          </section>

          <fieldset className={`card ${styles.section} ${raw ? styles.sectionMuted : ''}`} disabled={!!raw}>
            <div className={styles.sectionHeader}>
              <div><h3>Can reach</h3><p>Which project and environment this key's collection claims target.</p></div>
            </div>
            {role === 'root' ? (
              <p className={styles.rootNote}>A root key ignores reach — it covers every project and environment.</p>
            ) : (
              <NewKeyReach
                reach={reach}
                project={project}
                env={env}
                projects={projects}
                environments={environments}
                loadingEnvironments={loadingEnvironments}
                blocked={blockedReaches}
                onChange={changeReach}
              />
            )}
          </fieldset>

          <fieldset className={`card ${styles.section} ${raw ? styles.sectionMuted : ''}`} disabled={!!raw}>
            <div className={styles.sectionHeader}>
              <div><h3>Can do</h3><p>Each role includes everything the one before it grants.</p></div>
            </div>
            <div className={styles.roles}>
              {ROLES.map((option) => {
                const blocked = roleBlocked(option.value)
                return (
                  <button
                    key={option.value}
                    type="button"
                    className={`${styles.role} ${role === option.value ? styles.roleActive : ''} ${option.value === 'root' ? styles.roleRoot : ''}`}
                    disabled={blocked}
                    title={blocked ? 'The current key cannot delegate this role.' : undefined}
                    onClick={() => changeRole(option.value)}
                  >
                    <b>{option.label}</b>
                    <span>{option.blurb}</span>
                  </button>
                )
              })}
            </div>
          </fieldset>

          <section className={`card ${styles.section} ${styles.advanced}`}>
            <button type="button" className={styles.advancedToggle} onClick={() => setAdvancedOpen(!advancedOpen)}>
              {advancedOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
              <span><b>Advanced</b><small>Narrow to named collections, add instance capabilities, or write claims by hand.</small></span>
            </button>

            {advancedOpen && (
              <div className={styles.advancedBody}>
                {raw ? (
                  <div className={styles.rawPanel}>
                    <div className={styles.rawHead}>
                      <div><b>Editing claims directly</b><span>The guided controls above are paused while this is open.</span></div>
                      <Button variant="secondary" size="sm" onClick={() => setRawText(null)}>
                        <Undo2 size={13} /> Return to guided controls
                      </Button>
                    </div>
                    <textarea
                      className={`input mono ${styles.rawInput}`}
                      spellCheck={false}
                      rows={10}
                      value={rawText ?? ''}
                      onChange={(event) => setRawText(event.target.value)}
                    />
                    {raw.error
                      ? <div className="field-error">{raw.error}</div>
                      : <span className="field-hint">{raw.claims.length} valid claim{raw.claims.length === 1 ? '' : 's'}, one per line or comma-separated.</span>}
                  </div>
                ) : (
                  <>
                    {canNarrow && (
                      <div className="field">
                        <label className="field-label">Collections</label>
                        <div className={styles.scopeChoices}>
                          <button type="button" className={`${styles.scopeChoice} ${!narrowed ? styles.scopeChoiceActive : ''}`} onClick={() => setNarrowed(false)}>
                            <b>All collections</b>
                            <span>Every collection in {project}/{env}, including ones created later</span>
                          </button>
                          <button type="button" className={`${styles.scopeChoice} ${narrowed ? styles.scopeChoiceActive : ''}`} onClick={() => setNarrowed(true)}>
                            <b>Selected collections</b>
                            <span>New collections stay denied</span>
                          </button>
                        </div>
                        {narrowed && (
                          <div className={styles.collectionPicker}>
                            <button type="button" className={styles.pickerTrigger} onClick={() => setPickerOpen(!pickerOpen)}>
                              <span>{selected.length ? `${selected.length} selected` : 'Choose collections…'}</span>
                              <ChevronDown size={15} />
                            </button>
                            {pickerOpen && (
                              <div className={styles.pickerPopover}>
                                <div className={styles.collectionSearch}>
                                  <Search size={14} />
                                  <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search collections" />
                                </div>
                                <div className={styles.collectionOptions}>
                                  {visibleCollections.map((name) => (
                                    <label key={name}>
                                      <input type="checkbox" checked={selected.includes(name)} onChange={() => toggleCollection(name)} />
                                      <span>{name}</span>
                                    </label>
                                  ))}
                                  {visibleCollections.length === 0 && <span className="muted">No collections found.</span>}
                                </div>
                              </div>
                            )}
                            {selected.length > 0 && (
                              <div className={styles.selectedChips}>
                                {selected.map((name) => (
                                  <button type="button" key={name} onClick={() => toggleCollection(name)}>{name}<span>×</span></button>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {role !== 'root' && (
                      <NewKeyCapabilities
                        capabilities={capabilities}
                        transferReplace={transferReplace}
                        ownClaims={ownClaims}
                        onToggle={toggleCapability}
                        onTransferReplace={setTransferReplace}
                      />
                    )}

                    <div className={styles.rawEntry}>
                      <div><b>Not expressible above?</b><span>Edit the claim list by hand, seeded with what the controls produced.</span></div>
                      <Button variant="secondary" size="sm" onClick={() => setRawText(requestedClaims.join('\n'))}>
                        <Code2 size={13} /> Edit claims directly
                      </Button>
                    </div>
                  </>
                )}
              </div>
            )}
          </section>

          <NewKeyReview
            claims={requestedClaims}
            scopeLabel={role === 'root' && !raw ? 'every project / every environment' : NewKeyPlan.describeScope(input)}
            project={planScope.project === Claims.Root ? undefined : planScope.project}
            env={planScope.env === Claims.Root ? undefined : planScope.env}
            canDelegate={canDelegate}
          />
        </div>
      </div>
    </>
  )
}
