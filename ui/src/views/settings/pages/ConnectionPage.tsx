import React, { useEffect, useState } from 'react'
import {
  Globe,
  Trash2,
  AlertTriangle,
  Check,
  Activity,
  Shield,
  Eye,
  EyeOff,
} from 'lucide-react'
import { Button } from '../../../components/Button'
import { Modal } from '../../../components/Modal'
import { ModalActions } from '../../../components/ModalActions'
import { ModalBody } from '../../../components/ModalBody'
import { ModalCopy } from '../../../components/ModalCopy'
import { ModalHeader } from '../../../components/ModalHeader'
import { ModalIcon } from '../../../components/ModalIcon'
import { Pill } from '../../../components/Pill'
import { TopBar } from '../../shell/TopBar'
import { api } from '../../../api/api-client'
import type { Server } from '../../servers/server'
import passwordStyles from '../../../components/PasswordInput.module.css'
import styles from '../SettingsView.module.css'

interface ConnectionPageProps {
  server: Server
  session: string
  claims: string[]
  sessionLabel: string
  keyPrefix: string
  version: string
  onUpdateServer: (patch: Partial<Server>) => void
  onDeleteServer: () => void
}

export function ConnectionPage({
  server,
  session,
  claims: initialClaims,
  sessionLabel: initialSessionLabel,
  keyPrefix: initialKeyPrefix,
  version: initialVersion,
  onUpdateServer,
  onDeleteServer,
}: ConnectionPageProps) {
  const [connName, setConnName] = useState(server.name)
  const [connUrl, setConnUrl] = useState(server.url)
  const [connApiKey, setConnApiKey] = useState(server.apiKey)
  const [showKey, setShowKey] = useState(false)

  const [testingConn, setTestingConn] = useState(false)
  const [connStatus, setConnStatus] = useState<'idle' | 'online' | 'error'>('online')
  const [connStatusMsg, setConnStatusMsg] = useState('')
  const [pingMs, setPingMs] = useState<number | null>(null)
  const [version, setVersion] = useState(initialVersion)
  const [sessionLabel, setSessionLabel] = useState(initialSessionLabel)
  const [keyPrefix, setKeyPrefix] = useState(initialKeyPrefix)
  const [claims, setClaims] = useState(initialClaims)

  const [savingConn, setSavingConn] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [error, setError] = useState('')
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false)

  useEffect(() => {
    setVersion(initialVersion)
    setSessionLabel(initialSessionLabel)
    setKeyPrefix(initialKeyPrefix)
    setClaims(initialClaims)
  }, [initialVersion, initialSessionLabel, initialKeyPrefix, initialClaims])

  const handleTest = async () => {
    setTestingConn(true)
    setConnStatus('idle')
    setConnStatusMsg('')
    const start = performance.now()
    try {
      const [health, sess] = await Promise.all([
        api.health(connUrl.trim()),
        api.getSession(connUrl.trim(), connApiKey.trim()),
      ])
      const duration = Math.round(performance.now() - start)
      setConnStatus('online')
      setPingMs(duration)
      setVersion(health.version)
      setSessionLabel(sess.label)
      setKeyPrefix(sess.prefix)
      setClaims(sess.claims || [])
    } catch (err: any) {
      setConnStatus('error')
      setConnStatusMsg(err.message || 'Connection failed')
    } finally {
      setTestingConn(false)
    }
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSaveSuccess(false)

    const trimmedName = connName.trim()
    let trimmedUrl = connUrl.trim()
    const trimmedKey = connApiKey.trim()

    if (!trimmedName || !trimmedUrl || !trimmedKey) {
      setError('Name, URL, and API Key are all required.')
      return
    }

    if (!trimmedUrl.startsWith('http://') && !trimmedUrl.startsWith('https://')) {
      trimmedUrl = 'http://' + trimmedUrl
    }

    setSavingConn(true)
    try {
      const verifyRes = await api.verify(trimmedUrl, trimmedKey)
      if (verifyRes.ok) {
        onUpdateServer({
          name: trimmedName,
          url: trimmedUrl,
          apiKey: trimmedKey,
        })
        setSaveSuccess(true)
        setTimeout(() => setSaveSuccess(false), 2500)
      } else {
        setError('Verification failed: Invalid API key.')
      }
    } catch (err: any) {
      setError(`Verification failed: ${err.message || 'Server unreachable'}`)
    } finally {
      setSavingConn(false)
    }
  }

  return (
    <>
      <TopBar crumbs={[{ label: server.name }, { label: 'Connection' }]} session={session} />

      <div className="content">
        <div className="page-head">
          <div className="page-title-group">
            <h2 className="page-title">Connection</h2>
            <span className="page-sub">
              Configure server connection endpoints, check health diagnostics, and manage server storage.
            </span>
          </div>
        </div>

        {error && (
          <div className={styles.alertError}>
            <AlertTriangle size={15} />
            <span>{error}</span>
          </div>
        )}

        <div className={styles.generalContent}>
          {/* Connection Details */}
          <section className={styles.card}>
            <div className={styles.cardHeader}>
              <div className={styles.sectionTitle}>
                <Globe size={16} />
                <h2>Connection Details</h2>
              </div>
              <p>Configure connection endpoints and authentication credentials for this server.</p>
            </div>

            <form onSubmit={handleSave} className={styles.form}>
              <div className={styles.inputGrid}>
                <div className={styles.inputGroup}>
                  <label htmlFor="server-name">Server Name</label>
                  <input
                    id="server-name"
                    type="text"
                    value={connName}
                    onChange={(e) => setConnName(e.target.value)}
                    placeholder="e.g. Production US-East"
                    required
                  />
                </div>

                <div className={styles.inputGroup}>
                  <label htmlFor="server-url">Server URL</label>
                  <input
                    id="server-url"
                    type="text"
                    value={connUrl}
                    onChange={(e) => setConnUrl(e.target.value)}
                    placeholder="http://localhost:8090"
                    required
                  />
                </div>
              </div>

              <div className={styles.inputGroup}>
                <label htmlFor="server-key">API Key</label>
                <div className={passwordStyles.wrapper}>
                  <input
                    id="server-key"
                    type={showKey ? 'text' : 'password'}
                    value={connApiKey}
                    onChange={(e) => setConnApiKey(e.target.value)}
                    placeholder="silo_..."
                    required
                  />
                  <button
                    type="button"
                    className={passwordStyles.toggle}
                    onClick={() => setShowKey(!showKey)}
                    title={showKey ? 'Hide key' : 'Show key'}
                  >
                    {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              {saveSuccess && (
                <div className={styles.alertSuccess}>
                  <Check size={15} />
                  <span>Connection settings saved successfully.</span>
                </div>
              )}

              <div className={styles.formActions}>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleTest}
                  disabled={testingConn || savingConn}
                >
                  <Activity size={14} />
                  <span>{testingConn ? 'Testing…' : 'Test Connection'}</span>
                </Button>

                <Button type="submit" variant="primary" disabled={savingConn || testingConn}>
                  <Check size={14} />
                  <span>{savingConn ? 'Saving…' : 'Save Changes'}</span>
                </Button>
              </div>
            </form>
          </section>

          {/* Diagnostics */}
          <section className={styles.card}>
            <div className={styles.cardHeader}>
              <div className={styles.sectionTitle}>
                <Activity size={16} />
                <h2>Live Diagnostics</h2>
              </div>
              <p>Real-time information reported by this Silo server instance.</p>
            </div>

            <div className={styles.diagnosticsGrid}>
              <div className={styles.diagCard}>
                <span className={styles.diagLabel}>Server Status</span>
                <div className={styles.statusRow}>
                  {connStatus === 'online' ? (
                    <span className={styles.statusOnline}>
                      <span className={styles.statusDot} />
                      Connected {pingMs != null ? `(${pingMs}ms)` : ''}
                    </span>
                  ) : connStatus === 'error' ? (
                    <span className={styles.statusError}>
                      <span className={styles.statusDot} />
                      Unreachable
                    </span>
                  ) : (
                    <span className={styles.statusChecking}>Checking…</span>
                  )}
                </div>
                {connStatusMsg && <small className={styles.diagError}>{connStatusMsg}</small>}
              </div>

              <div className={styles.diagCard}>
                <span className={styles.diagLabel}>Silo Version</span>
                <span className={styles.diagValue}>{version ? `v${version}` : '—'}</span>
              </div>

              <div className={styles.diagCard}>
                <span className={styles.diagLabel}>API Key</span>
                <span className={styles.diagMono}>
                  {sessionLabel ? `${sessionLabel} (${keyPrefix}…)` : keyPrefix ? `${keyPrefix}…` : '—'}
                </span>
              </div>
            </div>

            {claims.length > 0 && (
              <div className={styles.claimsBlock}>
                <div className={styles.claimsTitle}>
                  <Shield size={14} />
                  <span>Active Key Capabilities</span>
                </div>
                <div className={styles.claimsList}>
                  {claims.includes('*') ? (
                    <Pill tone="accent">root · full access</Pill>
                  ) : (
                    claims.map((c) => (
                      <Pill key={c} tone="ok">
                        {c}
                      </Pill>
                    ))
                  )}
                </div>
              </div>
            )}
          </section>

          {/* Danger Zone */}
          <section className={`${styles.card} ${styles.dangerCard}`}>
            <div className={styles.cardHeader}>
              <div className={styles.dangerTitle}>
                <Trash2 size={16} className={styles.dangerIcon} />
                <h2>Danger Zone</h2>
              </div>
              <p>Manage permanent actions for this server connection in your local environment.</p>
            </div>

            <div className={styles.dangerItem}>
              <div className={styles.dangerItemInfo}>
                <span className={styles.dangerItemTitle}>Delete Server Connection</span>
                <p className={styles.dangerItemDesc}>
                  Remove this server from your saved connections in this browser. Your databases, collections,
                  and records hosted on the remote Silo instance remain completely untouched.
                </p>
              </div>

              <Button
                type="button"
                variant="danger"
                onClick={() => setIsConfirmingDelete(true)}
              >
                <Trash2 size={14} />
                <span>Delete Server</span>
              </Button>
            </div>
          </section>
        </div>
      </div>

      {/*
        No typed confirmation here, unlike deleting a project or an
        environment: this forgets a connection in this browser and destroys
        nothing on the server, so it is undone by re-entering the URL and key.
      */}
      {isConfirmingDelete && (
        <Modal onClose={() => setIsConfirmingDelete(false)}>
          <ModalHeader>
            <ModalIcon tone="bad">
              <Trash2 size={20} />
            </ModalIcon>
            <ModalCopy>
              <h3>Forget this server?</h3>
              <ModalBody>
                <b>{server.name}</b> is removed from this browser's saved connections. Everything hosted
                on the instance itself stays exactly as it is.
              </ModalBody>
            </ModalCopy>
          </ModalHeader>
          <ModalActions>
            <Button variant="secondary" onClick={() => setIsConfirmingDelete(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={onDeleteServer}>
              Forget server
            </Button>
          </ModalActions>
        </Modal>
      )}
    </>
  )
}
