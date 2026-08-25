import { useState } from 'react'
import { SiloRef } from '@silo/shared/silo-ref'
import type { Collection } from '../../api/types/collection'
import { Segmented } from '../../components/controls/Segmented'
import styles from './SchemaEditor.module.css'

// RefTarget picks what a Reference field points at: another collection on this
// server (silo://collections/<name>) or a remote JSON Schema URL.
export function RefTarget({
  target,
  collections,
  onChange,
  isArray = false,
}: {
  target: string
  collections: Collection[]
  onChange: (target: string) => void
  isArray?: boolean
}) {
  const [mode, setMode] = useState<'local' | 'remote'>(SiloRef.isRemote(target) ? 'remote' : 'local')
  const switchMode = (m: 'local' | 'remote') => {
    if (m === mode) return
    setMode(m)
    onChange('') // targets aren't interchangeable across modes
  }
  const localName = SiloRef.isLocal(target) ? SiloRef.collectionOf(target) : ''
  const remoteBad = mode === 'remote' && target !== '' && !SiloRef.isRemote(target)
  return (
    <div className={styles.fieldEditorColumn}>
      <span className={styles.fieldEditorLabel}>Reference target</span>
      <Segmented
        value={mode}
        variant="compact"
        onChange={switchMode}
        options={[
          { value: 'local', label: 'Local collection' },
          { value: 'remote', label: 'Remote schema URL' },
        ]}
      />
      {mode === 'local' ? (
        <>
          <select
            className={`input ${styles.compactInput}`}
            value={localName}
            onChange={(e) => onChange(e.target.value ? SiloRef.url(e.target.value) : '')}
          >
            <option value="">Choose a collection…</option>
            {collections.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
          <span className={styles.hint}>
            {isArray ? 'Each array item must match the collection' : 'Values must match the collection'}'s schema (
            <span className="mono">{localName ? SiloRef.url(localName) : `${SiloRef.CollectionScheme}…`}</span>).
          </span>
        </>
      ) : (
        <>
          <input
            className={`input mono ${styles.compactInput}`}
            placeholder="https://example.com/schema.json"
            value={SiloRef.isLocal(target) ? '' : target}
            onChange={(e) => onChange(e.target.value.trim())}
          />
          <span className={`${styles.hint} ${remoteBad ? styles.badHint : ''}`}>
            {remoteBad
              ? 'Must be an http(s) URL.'
              : 'Remote refs are off by default — the server needs allow_remote_refs = true under [schema] to fetch this during validation.'}
          </span>
        </>
      )}
    </div>
  )
}
