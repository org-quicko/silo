import { useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { AlertCircle, BookOpen, Check } from 'lucide-react'
import type { Claim } from '@silo/shared/claim'
import { Button } from '../../components/buttons/Button'
import { ClaimReference } from './ClaimReference'
import { PatternPreview } from './PatternPreview'
import type { ScopeCatalog } from './use-scope-catalog'
import styles from './KeyForm.module.css'

interface Props {
  text: string
  parsed: { claims: Claim[]; error: string }
  catalog: ScopeCatalog
  onChange: (text: string) => void
}

/**
 * The claim list, written by hand.
 *
 * This is why the two tabs beside it are allowed to stay small: anything they
 * cannot express is still reachable here, seeded with whatever the controls
 * produced. The reference beside it is not decoration — a free-text field over
 * a closed vocabulary is only usable if the vocabulary is one click away.
 */
export function CustomTab({ text, parsed, catalog, onChange }: Props) {
  const [referenceOpen, setReferenceOpen] = useState(false)
  const valid = !parsed.error

  return (
    <div className={styles.block}>
      <div className={styles.customHead}>
        <div>
          <h3>Claims</h3>
          <p>One per line, or comma-separated. A scope segment may end in * to match a name prefix.</p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => setReferenceOpen(true)}>
          <BookOpen size={13} /> Claim reference
        </Button>
      </div>

      <div className={styles.customEditor}>
        <CodeMirror
          value={text}
          height="260px"
          theme="dark"
          basicSetup={{ lineNumbers: true, foldGutter: false, autocompletion: false }}
          onChange={onChange}
        />
      </div>

      <div className={`${styles.validity} ${valid ? '' : styles.invalid}`}>
        {valid ? <Check size={14} /> : <AlertCircle size={14} />}
        <span>
          {valid
            ? `${parsed.claims.length} valid claim${parsed.claims.length === 1 ? '' : 's'}`
            : parsed.error}
        </span>
      </div>

      <PatternPreview claims={parsed.claims} catalog={catalog} />

      {referenceOpen && (
        <ClaimReference
          onInsert={(claim) => onChange(text.trim() ? `${text.replace(/\s+$/, '')}\n${claim}` : claim)}
          onClose={() => setReferenceOpen(false)}
        />
      )}
    </div>
  )
}
