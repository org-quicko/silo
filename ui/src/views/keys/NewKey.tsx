import { Button } from '../../components/Button'
import { useMemo, useState } from 'react'
import { Check, ChevronDown, KeyRound, Lock, Search, ShieldCheck } from 'lucide-react'
import { Claims } from '@silo/shared/claims'
import type { Claim } from '@silo/shared/claim'
import type { ClaimPreset } from '@silo/shared/claim-preset'
import type { CollectionPermission } from '@silo/shared/collection-permission'
import { api } from '../../api/api-client'
import type { CreatedKey } from '../../api/types/created-key'
import type { ScopeRef } from '../../api/types/scope-ref'
import { CopyButton } from '../../components/CopyButton'
import { Segmented } from '../../components/Segmented'
import { TopBar } from '../shell/TopBar'
import { ModalIcon } from '../../components/ModalIcon'
import styles from './NewKey.module.css'

type Mode = 'standard' | 'custom'

interface ClaimColumn {
  label: string
  permission: CollectionPermission
  title: string
  dangerous?: boolean
}

interface SystemClaim {
  claim: Claim
  label: string
  help: string
  dangerous?: boolean
}

class NewKeyOptions {
  static readonly columns: ClaimColumn[] = [
    { label: 'Schema', permission: Claims.CollectionSchemaRead, title: 'Read and discover the collection schema' },
    { label: 'C', permission: Claims.CollectionEntriesCreate, title: 'Create entries' },
    { label: 'R', permission: Claims.CollectionEntriesRead, title: 'Read entries' },
    { label: 'U', permission: Claims.CollectionEntriesUpdate, title: 'Update entries' },
    { label: 'D', permission: Claims.CollectionEntriesDelete, title: 'Delete entries', dangerous: true },
    { label: 'Edit schema', permission: Claims.CollectionSchemaUpdate, title: 'Update the collection schema' },
    { label: 'Access', permission: Claims.CollectionAccessUpdate, title: 'Change public/private read access', dangerous: true },
    { label: 'Delete', permission: Claims.CollectionDelete, title: 'Delete the entire collection', dangerous: true },
  ]

  static systemGroups(scope: ScopeRef): { title: string; claims: SystemClaim[] }[] {
    return [
    {
      title: 'Collection lifecycle',
      claims: [{ claim: Claims.collection(scope.project, scope.env, Claims.Root, Claims.CollectionCreate), label: 'Create collections', help: `Create a collection with any valid name in ${scope.project}/${scope.env}.` }],
    },
    {
      title: 'Media',
      claims: [
        { claim: Claims.MediaRead, label: 'Read', help: 'List media metadata.' },
        { claim: Claims.MediaCreate, label: 'Upload', help: 'Upload new media.' },
        { claim: Claims.MediaDelete, label: 'Delete', help: 'Delete media files.', dangerous: true },
      ],
    },
    {
      title: 'API keys',
      claims: [
        { claim: Claims.KeysRead, label: 'Read', help: 'List key metadata and claims.' },
        { claim: Claims.KeysCreate, label: 'Create', help: 'Mint keys without exceeding this key’s own claims.' },
        { claim: Claims.KeysRevoke, label: 'Revoke', help: 'Revoke any API key.', dangerous: true },
        { claim: Claims.KeysExport, label: 'Export', help: 'Include key hashes in exports.', dangerous: true },
        { claim: Claims.KeysImport, label: 'Import', help: 'Import key hashes, including root keys.', dangerous: true },
      ],
    },
    {
      title: 'Data transfer',
      claims: [
        // An archive spans every project and env, so each of these also
        // needs the matching collection permissions granted across all
        // projects — see Claims.Transfer*Permissions.
        { claim: Claims.TransferExport, label: 'Export', help: 'Export all schemas, entries, and media. Also needs read access across all projects.' },
        { claim: Claims.TransferImport, label: 'Import', help: 'Import and replace instance data. Also needs entry write access across all projects.', dangerous: true },
        { claim: Claims.TransferCopy, label: 'Server copy', help: 'Pull and import another silo. Also needs entry write access across all projects.', dangerous: true },
      ],
    },
    ]
  }

  static rowClaims(scope: ScopeRef, collection: string): Claim[] {
    return NewKeyOptions.columns.map((column) =>
      Claims.collection(scope.project, scope.env, collection, column.permission),
    )
  }
}

export function NewKeyView({
  url,
  apiKey,
  scope,
  ownClaims,
  collections,
  session,
  keysUrl,
  onCancel,
  onDone,
}: {
  url: string
  apiKey: string
  scope: ScopeRef
  ownClaims: string[] | Claim[]
  collections: string[]
  session: string
  keysUrl: string
  onCancel: () => void
  onDone: () => void
}) {
  const [label, setLabel] = useState('')
  const [mode, setMode] = useState<Mode>('standard')
  const [preset, setPreset] = useState<ClaimPreset>('read')
  const [scopeLevel, setScopeLevel] = useState<'env' | 'project' | 'all'>('env')
  const [allCollections, setAllCollections] = useState(true)
  const [selected, setSelected] = useState<string[]>([])
  const [customClaims, setCustomClaims] = useState<Claim[]>([])
  const [query, setQuery] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<CreatedKey | null>(null)

  const scopePrefix = `${scope.project}/${scope.env}`
  const requestedClaims = useMemo(() => {
    if (mode === 'custom') return Claims.normalize(customClaims)
    if (preset === 'root') return [Claims.Root]
    if (scopeLevel === 'all') {
      return Claims.fromPreset(preset, ['*/*/*'])
    }
    if (scopeLevel === 'project') {
      return Claims.fromPreset(preset, [`${scope.project}/*/*`])
    }
    const targets = allCollections
      ? [`${scopePrefix}/*`]
      : selected.map((name) => `${scopePrefix}/${name}`)
    return Claims.fromPreset(preset, targets)
  }, [mode, preset, scopeLevel, allCollections, selected, customClaims, scopePrefix, scope.project])
  const canDelegate = Claims.canDelegate(ownClaims as Claim[], requestedClaims as Claim[])
  const visibleCollections = collections.filter((name) => name.includes(query.trim().toLowerCase()))

  const toggleCollection = (name: string) => {
    setSelected(selected.includes(name) ? selected.filter((item) => item !== name) : [...selected, name])
  }
  const toggleClaim = (claim: Claim) => {
    setCustomClaims(customClaims.includes(claim) ? customClaims.filter((item) => item !== claim) : [...customClaims, claim])
  }
  const scoped = (collection: string, permission: CollectionPermission) =>
    Claims.collection(scope.project, scope.env, collection, permission)
  const setRowPreset = (collection: string, rowPreset: 'none' | 'read' | 'crud') => {
    const rowClaims = NewKeyOptions.rowClaims(scope, collection)
    const next = customClaims.filter((claim) => !rowClaims.includes(claim))
    const addAllowed = (...claims: Claim[]) => next.push(...claims.filter((claim) => Claims.has(ownClaims, claim)))
    if (rowPreset !== 'none') {
      addAllowed(
        scoped(collection, Claims.CollectionSchemaRead),
        scoped(collection, Claims.CollectionEntriesRead),
      )
    }
    if (rowPreset === 'crud') {
      addAllowed(
        scoped(collection, Claims.CollectionEntriesCreate),
        scoped(collection, Claims.CollectionEntriesUpdate),
        scoped(collection, Claims.CollectionEntriesDelete),
      )
    }
    setCustomClaims(Claims.normalize(next))
  }

  const submit = async () => {
    if (!label.trim()) return setError('A label is required.')
    if (mode === 'standard' && preset !== 'root' && !allCollections && selected.length === 0) {
      return setError('Select at least one collection or choose all collections.')
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
        <div className={`content ${styles.wrap}`}>
          <div className={`card ${styles.success}`}>
            <ModalIcon tone="ok" className={styles.successIcon}><Check size={20} /></ModalIcon>
            <h2>Copy this key now</h2>
            <p>silo stores only its SHA-256 hash. This secret cannot be shown again.</p>
            <div className={styles.secretBox}><span className={styles.secret}>{created.key}</span><CopyButton text={created.key} variant="accent" /></div>
            <div className={styles.summary}><b>{created.label}</b><span>{Claims.label(created.claims)}</span></div>
            <div className={styles.codeList}>{created.claims.map((claim) => <code key={claim}>{claim}</code>)}</div>
            <div className={styles.successFooter}><span className={styles.lockNote}><Lock size={13} /> Shown once</span><Button variant="primary" onClick={onDone}>I’ve saved it</Button></div>
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
      <div className={`content ${styles.wrap}`}>
        <div className="page-head">
          <div className="page-title-group">
            <div className="page-title-row"><span className={styles.pageIcon}><KeyRound size={19} /></span><h2 className="page-title">Create an API key</h2></div>
            <span className="page-sub">Start with a safe preset or assign every capability explicitly. Collection claims target <code>{scopePrefix}</code>.</span>
          </div>
        </div>

        {error && <div className="banner banner-bad"><span>{error}</span></div>}

        <section className={`card ${styles.section}`}>
          <div className={styles.sectionHeader}><div><h3>Key details</h3><p>A descriptive label helps identify the integration later.</p></div></div>
          <div className="field"><label className="field-label">Label</label><input className="input" autoFocus placeholder="e.g. web-frontend" value={label} onChange={(event) => setLabel(event.target.value)} /></div>
        </section>

        <section className={`card ${styles.section}`}>
          <div className={styles.sectionHeader}><div><h3>Permissions</h3><p>Claims are explicit and denied by default.</p></div><Segmented value={mode} onChange={setMode} options={[{ value: 'standard', label: 'Standard' }, { value: 'custom', label: 'Custom claims' }]} /></div>

          {mode === 'standard' ? (
            <div className={styles.standard}>
              <div className="field"><label className="field-label">Preset</label><Segmented value={preset} onChange={setPreset} options={[{ value: 'read', label: 'Read only' }, { value: 'write', label: 'Read & write' }, { value: 'root', label: 'Root' }]} /></div>
              {preset !== 'root' && (
                <>
                  <div className="field">
                    <label className="field-label">Scope Level</label>
                    <Segmented
                      value={scopeLevel}
                      onChange={setScopeLevel}
                      options={[
                        { value: 'env', label: `Environment (${scope.project}/${scope.env})` },
                        { value: 'project', label: `Project (${scope.project})` },
                        { value: 'all', label: 'All Projects' },
                      ]}
                    />
                  </div>
                  {scopeLevel === 'env' && (
                    <div className="field">
                      <label className="field-label">Collections</label>
                      <div className={styles.scopeChoices}>
                        <button className={`${styles.scopeChoice} ${allCollections ? styles.scopeChoiceActive : ''}`} onClick={() => setAllCollections(true)}><b>All collections</b><span>Every collection in {scopePrefix}, including ones created later</span></button>
                        <button className={`${styles.scopeChoice} ${!allCollections ? styles.scopeChoiceActive : ''}`} onClick={() => setAllCollections(false)}><b>Selected collections</b><span>New collections stay denied</span></button>
                      </div>
                      {!allCollections && (
                        <div className={styles.collectionPicker}>
                          <button className={styles.pickerTrigger} onClick={() => setPickerOpen(!pickerOpen)}><span>{selected.length ? `${selected.length} selected` : 'Choose collections…'}</span><ChevronDown size={15} /></button>
                          {pickerOpen && <div className={styles.pickerPopover}><div className={styles.collectionSearch}><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search collections" /></div><div className={styles.collectionOptions}>{visibleCollections.map((name) => <label key={name}><input type="checkbox" checked={selected.includes(name)} onChange={() => toggleCollection(name)} /><span>{name}</span></label>)}{visibleCollections.length === 0 && <span className="muted">No collections found.</span>}</div></div>}
                          {selected.length > 0 && <div className={styles.selectedChips}>{selected.map((name) => <button key={name} onClick={() => toggleCollection(name)}>{name}<span>×</span></button>)}</div>}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          ) : (
            <div>
              <div className={styles.matrixWrap}>
                <div className={styles.matrixHeader}><div><b>Collection claims</b><span>Use row presets or toggle individual claims.</span></div><div className={`${styles.collectionSearch} ${styles.inlineSearch}`}><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter collections" /></div></div>
                <div className={styles.matrix}>
                  <div className={`${styles.matrixRow} ${styles.matrixRowHeader}`}><span>Collection</span><span>Preset</span>{NewKeyOptions.columns.map((column) => <span key={column.permission} title={column.title}>{column.label}</span>)}</div>
                  {visibleCollections.map((name) => (
                    <div className={styles.matrixRow} key={name}>
                      <b>{name}</b>
                      <span className={styles.rowPresets}><button onClick={() => setRowPreset(name, 'none')}>None</button><button onClick={() => setRowPreset(name, 'read')}>Read</button><button onClick={() => setRowPreset(name, 'crud')}>CRUD</button></span>
                      {NewKeyOptions.columns.map((column) => {
                        const claim = scoped(name, column.permission)
                        const allowed = Claims.has(ownClaims, claim)
                        return <label key={column.permission} className={`${styles.claimCheck} ${column.dangerous ? styles.dangerCheck : ''}`} title={allowed ? column.title : 'The current key cannot delegate this claim'}><input type="checkbox" checked={customClaims.includes(claim)} disabled={!allowed} onChange={() => toggleClaim(claim)} /><span><Check size={11} /></span></label>
                      })}
                    </div>
                  ))}
                </div>
              </div>

              <div className={styles.systemClaims}><div className={`${styles.sectionHeader} ${styles.compactHeader}`}><div><h3>Instance claims</h3><p>Capabilities that are not tied to one collection.</p></div></div>{NewKeyOptions.systemGroups(scope).map((group) => <div className={styles.systemGroup} key={group.title}><b>{group.title}</b><div>{group.claims.map((option) => { const allowed = Claims.has(ownClaims, option.claim); return <label key={option.claim} className={`${styles.systemClaim} ${option.dangerous ? styles.dangerClaim : ''} ${!allowed ? styles.disabledClaim : ''}`} title={!allowed ? 'The current key cannot delegate this claim' : option.help}><input type="checkbox" checked={customClaims.includes(option.claim)} disabled={!allowed} onChange={() => toggleClaim(option.claim)} /><span><ShieldCheck size={14} /><span><b>{option.label}</b><small>{option.claim}</small></span></span></label> })}</div></div>)}</div>
            </div>
          )}
        </section>

        <section className={`card ${styles.review}`}><div><b>Effective claims</b><span>{Claims.label(requestedClaims)}</span></div><div className={styles.codeList}>{requestedClaims.map((claim) => <code key={claim}>{claim}</code>)}</div>{!canDelegate && <div className="banner banner-warn">The current key cannot delegate this complete claim set.</div>}</section>
      </div>
    </>
  )
}
