import { useContext, type CSSProperties } from 'react'
import { ArrayItemHeaderContext } from './ArrayItemHeaderContext'
import { NestingDepthContext } from './NestingDepthContext'
import styles from './ObjectFieldTemplate.module.css'

export function ObjectFieldTemplate(props: any) {
  // Nested objects (including $ref'd collections) get a small group label so
  // their fields don't read as top-level ones; the root object stays bare, and
  // so does an array item whose collapsible header already names it.
  const id = props.fieldPathId?.$id
  const headed = useContext(ArrayItemHeaderContext) === id
  const depth = useContext(NestingDepthContext)
  const showLabel = id !== 'root' && !headed && props.title
  const fields = props.properties.map((p: any) => p.content)
  if (!showLabel) return <div className={styles.group}>{fields}</div>
  // The label alone left its fields sitting flush with everybody else's; the
  // rail is what makes them read as this group's, and it carries the depth so
  // a group inside a group is a visibly deeper line.
  const nested = depth + 1
  return (
    <div className={`${styles.group} ${styles.labelled}`}>
      <span className={styles.label}>{props.title}</span>
      <NestingDepthContext.Provider value={nested}>
        <div className={styles.rail} style={{ '--nest-depth': nested } as CSSProperties}>
          {fields}
        </div>
      </NestingDepthContext.Provider>
    </div>
  )
}
