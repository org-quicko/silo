import { useContext, useState } from 'react'
import { AlertTriangle, Braces } from 'lucide-react'
import { SiloRefs } from '../../schema/silo-refs'
import { ArrayItemHeaderContext } from '../templates/ArrayItemHeaderContext'
import styles from './JsonField.module.css'

// JsonField: raw-JSON fallback for oneOf/anyOf/opaque objects (D3). Implemented
// as a Field (not a Widget) so it fully replaces RJSF's oneOf/anyOf handling for
// the subtree — the whole value is edited as JSON and validated by the server.
export function JsonField(props: any) {
  const { name, schema, formData, onChange, fieldPathId, disabled, readonly } = props
  // An unresolved ref inside an array is titled by the item's collapsible
  // header; repeating RJSF's "<array>-<index>" name under it says nothing.
  const headed = useContext(ArrayItemHeaderContext) === fieldPathId?.$id
  const [text, setText] = useState(() => (formData === undefined ? '' : JSON.stringify(formData, null, 2)))
  const [bad, setBad] = useState(false)
  // RJSF v6 field onChange signature is (value, path, …); omitting the path
  // makes the Form merge the value at the ROOT of formData instead of here.
  const emit = (v: any) => onChange(v, fieldPathId?.path)
  const marker: string | undefined = schema?.[SiloRefs.markerKey]
  const markerKind: string | undefined = schema?.[SiloRefs.markerKindKey]
  // A property that constrains nothing is not a subtree the form failed to
  // draw — it is a field that accepts any JSON, which this editor is the right
  // control for rather than the fallback from one. It reads as such.
  const any = !marker && !schema?.oneOf && !schema?.anyOf && !schema?.type
  const kind = marker ? 'reference' : schema?.oneOf ? 'oneOf' : schema?.anyOf ? 'anyOf' : schema?.type || 'any'
  const notice =
    markerKind === 'remote' ? (
      <span>
        References a remote schema — <span className="mono">{marker}</span>. The form can't fetch it, so edit this
        value as raw JSON; silo validates on save (the server needs <span className="mono">allow_remote_refs</span> to
        fetch it).
      </span>
    ) : markerKind === 'cycle' ? (
      <span>
        Recursive reference (<span className="mono">{marker}</span>) — the form can't render it inline. Edit it as raw
        JSON; silo validates on save.
      </span>
    ) : markerKind === 'missing' ? (
      <span>
        References <span className="mono">{marker}</span>, which doesn't match a collection on this server. Edit it as
        raw JSON; silo validates on save.
      </span>
    ) : any ? (
      <span>Any JSON value: an object, a list, a string, a number, or nothing.</span>
    ) : (
      <span>This subtree has no simple control. Edit it as raw JSON — silo validates on save.</span>
    )
  return (
    <div className="field">
      <div className="field-label-row">
        {!headed && <label className="field-label">{schema?.title || name}</label>}
        <span className={`field-hint ${any ? '' : 'warn'}`}>
          {any ? 'any · JSON' : `${schema?.type ? `${schema.type} · ` : ''}${kind} — no generated control`}
        </span>
      </div>
      <div className={styles.editor}>
        <div className={`${styles.notice} ${any ? styles.plain : ''}`}>
          {any ? <Braces size={14} /> : <AlertTriangle size={14} />}
          {notice}
        </div>
        <textarea
          className={`${styles.area} ${bad ? styles.invalid : ''}`}
          value={text}
          disabled={disabled || readonly}
          spellCheck={false}
          placeholder="{ }"
          onChange={(e) => {
            setText(e.target.value)
            if (e.target.value.trim() === '') {
              emit(undefined)
              setBad(false)
              return
            }
            try {
              emit(JSON.parse(e.target.value))
              setBad(false)
            } catch {
              setBad(true)
            }
          }}
        />
      </div>
    </div>
  )
}
