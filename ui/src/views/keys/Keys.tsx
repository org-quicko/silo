import { Button } from '../../components/Button'
import { Pill } from '../../components/Pill'
import { useEffect, useState } from 'react'
import { KeyRound, Plus, Trash2 } from 'lucide-react'
import { Claims } from '@silo/shared/claims'
import { KeyFormat } from '@silo/shared/key-format'
import { api } from '../../api/api-client'
import { Formatters } from '../../utils/formatters'
import type { KeyView } from '../../api/types/key-view'
import { Modal } from '../../components/Modal'
import { ModalActions } from '../../components/ModalActions'
import { ModalBody } from '../../components/ModalBody'
import { ModalCopy } from '../../components/ModalCopy'
import { ModalHeader } from '../../components/ModalHeader'
import { ModalIcon } from '../../components/ModalIcon'
import { TopBar } from '../shell/TopBar'
import table from '../../components/DataTable.module.css'
import styles from './Keys.module.css'

import type { ScopeRef } from '../../api/types/scope-ref'

class KeyClaimSummary {
  static render(claims: string[]) {
    if (claims.includes('*')) return <Pill tone="accent">root · full access</Pill>
    if (claims.length === 0) return <Pill>no access</Pill>
    const first = claims.slice(0, 2).join(' · ')
    const rest = claims.length > 2 ? ` +${claims.length - 2}` : ''
    return <Pill tone="ok" title={claims.join('\n')}>{first}{rest}</Pill>
  }
}

export function KeysView({
  url,
  apiKey,
  scope: _scope,
  claims,
  session,
  onCreate,
}: {
  url: string
  apiKey: string
  scope?: ScopeRef
  claims: string[]
  session: string
  onCreate: () => void
}) {
  const [keys, setKeys] = useState<KeyView[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [toRevoke, setToRevoke] = useState<KeyView | null>(null)
  const currentPrefix = KeyFormat.displayPrefix(apiKey)
  const canCreate = Claims.has(claims, Claims.KeysCreate)
  const canRevoke = Claims.has(claims, Claims.KeysRevoke)
  const gridCols = '1.25fr 0.8fr 2fr 0.8fr 90px'

  const load = () => {
    setLoading(true)
    setLoadError('')
    api.listKeys(url, apiKey)
      .then(setKeys)
      .catch((error: any) => {
        setKeys([])
        setLoadError(error.message || 'Failed to load API keys.')
      })
      .finally(() => setLoading(false))
  }
  useEffect(load, [url, apiKey])

  const revoke = async () => {
    if (!toRevoke) return
    try {
      await api.revokeKey(url, apiKey, toRevoke.id)
      setToRevoke(null)
      load()
    } catch (error: any) {
      alert(error.message || 'Revoke failed')
    }
  }

  return (
    <>
      <TopBar crumbs={[{ label: 'Admin' }, { label: 'API keys' }]} session={session}>
        {canCreate && <Button variant="primary" onClick={onCreate}><Plus size={14} /> Create key</Button>}
      </TopBar>
      <div className="content">
        <div className="page-head">
          <div className="page-title-group">
            <h2 className="page-title">API keys</h2>
            <span className="page-sub">Claims grant explicit capabilities. Secrets are shown once and only their SHA-256 hashes are stored.</span>
          </div>
        </div>
        {loadError && <div className="banner banner-bad"><span>{loadError}</span><Button variant="secondary" size="sm" onClick={load}>Retry</Button></div>}
        <div className="card">
          <div className={`${table.header} ${table.table}`} style={{ ['--cols' as any]: gridCols }}>
            <span>Label</span><span>Key prefix</span><span>Claims</span><span>Created</span><span />
          </div>
          {keys.map((key) => {
            const isCurrent = key.prefix === currentPrefix
            return (
              <div key={key.id} className={table.row} style={{ ['--cols' as any]: gridCols }}>
                <div className={`${table.cell} ${styles.labelCell}`}>
                  <span className={styles.avatar}><KeyRound size={13} /></span>
                  <span className={styles.label}>{key.label}</span>
                </div>
                <div className={`${table.cell} ${styles.prefix}`}>{key.prefix}</div>
                <div className={table.cell}>{KeyClaimSummary.render(key.claims)}</div>
                <div className={`${table.cell} ${styles.date}`}>{Formatters.shortDate(key.created_at)}</div>
                <div className={`${table.cell} ${styles.actions}`}>
                  {isCurrent ? <span className={styles.current}>current</span> : canRevoke ? (
                    <Button variant="dangerGhost" size="sm" onClick={() => setToRevoke(key)}>Revoke</Button>
                  ) : null}
                </div>
              </div>
            )
          })}
          {!loading && !loadError && keys.length === 0 && <div className={styles.empty}><Trash2 size={22} /><span>No keys to show.</span></div>}
        </div>
      </div>

      {toRevoke && (
        <Modal onClose={() => setToRevoke(null)}>
          <ModalHeader>
            <ModalIcon tone="bad"><KeyRound size={20} /></ModalIcon>
            <ModalCopy>
              <h3>Revoke this key?</h3>
              <ModalBody><b>{toRevoke.label}</b> ({toRevoke.prefix}) will stop working immediately.</ModalBody>
            </ModalCopy>
          </ModalHeader>
          <ModalActions>
            <Button variant="secondary" onClick={() => setToRevoke(null)}>Cancel</Button>
            <Button variant="danger" onClick={revoke}>Revoke key</Button>
          </ModalActions>
        </Modal>
      )}
    </>
  )
}
