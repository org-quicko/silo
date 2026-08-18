import styles from './ObjectFieldTemplate.module.css'

export function ObjectFieldTemplate(props: any) {
  // Nested objects (including $ref'd collections) get a small group label so
  // their fields don't read as top-level ones; the root object stays bare.
  const isRoot = props.idSchema?.$id === 'root'
  return (
    <div className={styles.group}>
      {!isRoot && props.title && <span className={styles.label}>{props.title}</span>}
      {props.properties.map((p: any) => p.content)}
    </div>
  )
}
