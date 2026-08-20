import { useContext, useEffect, useState } from 'react'
import { AlertCircle, ChevronRight } from 'lucide-react'
import { getTemplate } from '@rjsf/utils'
import { SiloRefs } from '../../schema/silo-refs'
import { ValueTitle } from '../../utils/value-title'
import { ArrayItemHeaderContext } from './ArrayItemHeaderContext'
import { ArrayItemsContext } from './ArrayItemsContext'
import styles from './ArrayFieldItemTemplate.module.css'

// Slate array item. Composite items — a reference list, an inline object
// array, or a ref the client couldn't resolve (raw JSON) — collapse into a
// single header row carrying the item's own title, its position as metadata,
// and the move/copy/remove actions; a list of ten entries is otherwise a page
// of stacked forms. Scalar items have nothing to summarize, so they keep the
// flat row layout.
export function ArrayFieldItemTemplate(props: any) {
  const { buttonsProps, children, className, hasToolbar, index, itemKey, registry, schema, uiSchema } = props
  const uiOptions = registry.getUiOptions?.(uiSchema) || {}
  const ArrayFieldItemButtonsTemplate = getTemplate('ArrayFieldItemButtonsTemplate', registry, uiOptions)
  const ctx = useContext(ArrayItemsContext)
  const title = ValueTitle.of(schema, uiSchema, ctx?.data?.[index])
  const composite = schema?.type === 'object' || !!schema?.properties || !!schema?.[SiloRefs.markerKey]
  // An item with nothing to show in its header is one the user still has to
  // fill in — a just-added item — so it opens; saved items start collapsed.
  const [open, setOpen] = useState(title === null)

  const { command, report } = ctx || {}
  const nonce = command?.nonce
  useEffect(() => {
    if (command) setOpen(command.open)
    // Keyed on the nonce alone: a repeated "collapse all" must still reach an
    // item the user reopened in between, and `command` itself is a fresh
    // object on every array render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce])
  useEffect(() => {
    if (!composite) return
    report?.(itemKey, open)
    return () => report?.(itemKey, null)
  }, [composite, report, itemKey, open])

  const toolbar = hasToolbar ? (
    <div className={styles.toolbar}>
      <ArrayFieldItemButtonsTemplate {...buttonsProps} />
    </div>
  ) : null

  if (!composite) {
    return (
      <div className={`${styles.item} ${styles.row} ${className || ''}`}>
        <div className={styles.content}>{children}</div>
        {toolbar}
      </div>
    )
  }

  const bodyId = `${buttonsProps.fieldPathId.$id}__body`
  return (
    <div className={`${styles.item} ${open ? styles.open : ''} ${className || ''}`}>
      <div className={styles.header}>
        <button
          type="button"
          className={styles.disclosure}
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-controls={bodyId}
          title={open ? 'Collapse' : 'Expand'}
        >
          <ChevronRight size={14} className={styles.chevron} />
          <span className={styles.index}>{index + 1}</span>
          <span className={`${styles.title} ${title === null ? styles.untitled : ''}`}>{title ?? 'Untitled'}</span>
        </button>
        <AlertCircle size={14} className={styles.errorMark} />
        {toolbar}
      </div>
      <div id={bodyId} className={styles.body} hidden={!open}>
        <ArrayItemHeaderContext.Provider value={buttonsProps.fieldPathId.$id}>{children}</ArrayItemHeaderContext.Provider>
      </div>
    </div>
  )
}
