import { useState } from 'react'
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
import { Button } from '../../../components/buttons/Button'
import { Modal } from '../../../components/modal/Modal'
import { ModalActions } from '../../../components/modal/ModalActions'
import { ModalBody } from '../../../components/modal/ModalBody'
import { ModalCopy } from '../../../components/modal/ModalCopy'
import { ModalHeader } from '../../../components/modal/ModalHeader'
import { ModalIcon } from '../../../components/modal/ModalIcon'
import { Pill } from '../../../components/feedback/Pill'
import { Breadcrumb } from '../../../components/navigation/Breadcrumb'
import { TopBar } from '../../shell/TopBar'
import type { Server } from '../../servers/server'
import passwordStyles from '../../../components/controls/PasswordInput.module.css'
import styles from '../SettingsView.module.css'
import { useConnectionForm } from './use-connection-form'

interface ConnectionPageProps {
  server: Server
  claims: string[]
  sessionLabel: string
  keyPrefix: string
  version: string
  onUpdateServer: (patch: Partial<Server>) => void
  onDeleteServer: () => void
}

export function ConnectionPage({
  server,
  claims: initialClaims,
  sessionLabel: initialSessionLabel,
  keyPrefix: initialKeyPrefix,
  version: initialVersion,
  onUpdateServer,
  onDeleteServer,
}: ConnectionPageProps) {
  const form = useConnectionForm(
    server,
    {
      version: initialVersion,
      sessionLabel: initialSessionLabel,
      keyPrefix: initialKeyPrefix,
      claims: initialClaims,
    },
    onUpdateServer,
  )
  const [showKey, setShowKey] = useState(false)
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false)


  return (
    <>
      <TopBar />

      <div className="content">
        <Breadcrumb crumbs={[{ label: server.name }, { label: 'Connection' }]} />
        <div className="page-head">
          <div className="page-title-group">
            <h2 className="page-title">Connection</h2>
            <span className="page-sub">
              Configure server connection endpoints, check health diagnostics, and manage server storage.
            </span>
          </div>
        </div>

        {form.error && (
          <div className={styles.alertError}>
            <AlertTriangle size={15} />
            <span>{form.error}</span>
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

            <form onSubmit={form.save} className={styles.form}>
              <div className={styles.inputGrid}>
                <div className={styles.inputGroup}>
                  <label htmlFor="server-name">Server Name</label>
                  <input
                    id="server-name"
                    type="text"
                    value={form.name}
                    onChange={(e) => form.setName(e.target.value)}
                    placeholder="e.g. Production US-East"
                    required
                  />
                </div>

                <div className={styles.inputGroup}>
                  <label htmlFor="server-url">Server URL</label>
                  <input
                    id="server-url"
                    type="text"
                    value={form.url}
                    onChange={(e) => form.setUrl(e.target.value)}
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
                    value={form.apiKey}
                    onChange={(e) => form.setApiKey(e.target.value)}
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

              {form.saved && (
                <div className={styles.alertSuccess}>
                  <Check size={15} />
                  <span>Connection settings saved successfully.</span>
                </div>
              )}

              <div className={styles.formActions}>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={form.test}
                  disabled={form.testing || form.saving}
                >
                  <Activity size={14} />
                  <span>{form.testing ? 'Testing…' : 'Test Connection'}</span>
                </Button>

                <Button type="submit" variant="primary" disabled={form.saving || form.testing}>
                  <Check size={14} />
                  <span>{form.saving ? 'Saving…' : 'Save Changes'}</span>
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
                  {form.status === 'online' ? (
                    <span className={styles.statusOnline}>
                      <span className={styles.statusDot} />
                      Connected {form.pingMs != null ? `(${form.pingMs}ms)` : ''}
                    </span>
                  ) : form.status === 'error' ? (
                    <span className={styles.statusError}>
                      <span className={styles.statusDot} />
                      Unreachable
                    </span>
                  ) : (
                    <span className={styles.statusChecking}>Checking…</span>
                  )}
                </div>
                {form.statusMessage && <small className={styles.diagError}>{form.statusMessage}</small>}
              </div>

              <div className={styles.diagCard}>
                <span className={styles.diagLabel}>Silo Version</span>
                <span className={styles.diagValue}>{form.facts.version ? `v${form.facts.version}` : '—'}</span>
              </div>

              <div className={styles.diagCard}>
                <span className={styles.diagLabel}>API Key</span>
                <span className={styles.diagMono}>
                  {form.facts.sessionLabel ? `${form.facts.sessionLabel} (${form.facts.keyPrefix})` : form.facts.keyPrefix || '—'}
                </span>
              </div>
            </div>

            {form.facts.claims.length > 0 && (
              <div className={styles.claimsBlock}>
                <div className={styles.claimsTitle}>
                  <Shield size={14} />
                  <span>Active Key Capabilities</span>
                </div>
                <div className={styles.claimsList}>
                  {form.facts.claims.includes('*') ? (
                    <Pill tone="accent">root · full access</Pill>
                  ) : (
                    form.facts.claims.map((claim: string) => (
                      <Pill key={claim} tone="ok">
                        {claim}
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
