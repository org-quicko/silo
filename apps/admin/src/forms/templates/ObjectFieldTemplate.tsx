import { useContext } from 'react'
import { ArrayItemHeaderContext } from './ArrayItemHeaderContext'
import styles from './ObjectFieldTemplate.module.css'

export function ObjectFieldTemplate(props: any) {
  // Nested objects (including $ref'd collections) get a small group label so
  // their fields don't read as top-level ones; the root object stays bare, and
  // so does an array item whose collapsible header already names it.
  const id = props.fieldPathId?.$id
  const headed = useContext(ArrayItemHeaderContext) === id
  const showLabel = id !== 'root' && !headed && props.title
  return (
    <div className={styles.group}>
      {showLabel && <span className={styles.label}>{props.title}</span>}
      {props.properties.map((p: any) => p.content)}
    </div>
  )
}
