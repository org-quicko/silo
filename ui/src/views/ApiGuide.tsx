import { Button } from '../components/Button'
import { Pill } from '../components/Pill'
import { useState } from 'react'
import { SchemaAccess } from '@silo/shared/schema-access'
import { Code2 } from 'lucide-react'
import { CopyButton } from '../components/CopyButton'
import { Modal } from '../components/Modal'
import { ModalActions } from '../components/ModalActions'
import type { Collection } from '../api/types/collection'
import type { ScopeRef } from '../api/types/scope-ref'
import styles from './ApiGuide.module.css'

// E3 — per-collection REST reference. Uses $SILO_KEY as a placeholder rather
// than the live key (the secret is never echoed back into copyable snippets).
// Rendered as a trigger button; the reference itself lives in a dialog so it
// doesn't compete with the entries table for space.
export function ApiGuide({ collection, url, scope }: { collection: Collection; url: string; scope: ScopeRef }) {
  const [open, setOpen] = useState(false)
  const host = url || window.location.origin
  const base = `${host.endsWith('/') ? host.slice(0, -1) : host}/api`
  const path = `/projects/${scope.project}/envs/${scope.env}/collections/${collection.name}`
  const isPrivate = SchemaAccess.requiresAuth(collection.schema)

  const props = collection.schema?.properties || {}
  const required: string[] = Array.isArray(collection.schema?.required) ? collection.schema.required : []
  const sample: Record<string, any> = {}
  for (const k of required.slice(0, 2)) {
    const t = props[k]?.type
    sample[k] = t === 'number' || t === 'integer' ? 1 : t === 'boolean' ? true : 'value'
  }
  if (Object.keys(sample).length === 0) {
    const first = Object.keys(props)[0]
    if (first) sample[first] = 'value'
  }
  const body = JSON.stringify(sample)

  const curl = `curl -X POST ${base}${path} \\
  -H "Authorization: Bearer $SILO_KEY" \\
  -H "Content-Type: application/json" \\
  -d '${body}'`

  const endpoints: { method: string; path: string; verb: string }[] = [
    { method: 'GET', path, verb: 'list' },
    { method: 'GET', path: `${path}/:id`, verb: 'read' },
    { method: 'POST', path, verb: 'create' },
    { method: 'PUT', path: `${path}/:id`, verb: 'update (full replace)' },
    { method: 'DELETE', path: `${path}/:id`, verb: 'delete' },
  ]

  return (
    <>
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        <Code2 size={14} /> API
      </Button>
      {open && (
        <Modal onClose={() => setOpen(false)} size="lg">
          <div className={styles.header}>
            <div className={styles.titleBlock}>
              <span className={styles.heading}>{collection.name} · REST API</span>
              <span className={styles.base}>
                Base <span className={styles.baseValue}>{base}</span>
              </span>
            </div>
            <Pill tone={isPrivate ? 'warn' : 'ok'}>
              {isPrivate ? 'Auth required' : 'Public read enabled'}
            </Pill>
          </div>
          <div className={styles.body}>
            <div className={styles.endpoints}>
              {endpoints.map((e, i) => (
                <div key={i} className={styles.endpoint}>
                  <span className={`${styles.method} ${styles[e.method.toLowerCase()]}`}>{e.method}</span>
                  <span className={styles.path}>{e.path}</span>
                  <span className={styles.verb}>{e.verb}</span>
                </div>
              ))}
            </div>
            <div className={styles.codeCard}>
              <div className={styles.codeHeader}>
                <span className={styles.codeLabel}>curl · create an entry</span>
                <CopyButton text={curl} />
              </div>
              <div className={styles.code}>
                <span className={styles.string}>curl</span> -X POST {base}
                {path} \{'\n'}
                {'  '}-H <span className={styles.string}>"Authorization: Bearer $SILO_KEY"</span> \{'\n'}
                {'  '}-H <span className={styles.string}>"Content-Type: application/json"</span> \{'\n'}
                {'  '}-d <span className={styles.string}>'{body}'</span>
              </div>
            </div>
          </div>
          <ModalActions>
            <Button variant="secondary" className={styles.closeAction} onClick={() => setOpen(false)}>
              Close
            </Button>
          </ModalActions>
        </Modal>
      )}
    </>
  )
}
