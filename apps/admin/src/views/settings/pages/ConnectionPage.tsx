import { useState } from 'react'
import { Activity, AlertTriangle, Eye, EyeOff, Trash2 } from 'lucide-react'
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
import { DestructiveRow } from '../parts/DestructiveRow'
import { DestructiveSection } from '../parts/DestructiveSection'
import { SettingsPageHead } from '../parts/SettingsPageHead'
import { SettingsRow } from '../parts/SettingsRow'
import { SettingsSection } from '../parts/SettingsSection'
import passwordStyles from '../../../components/controls/PasswordInput.module.css'
import ledger from '../parts/SettingsLedger.module.css'
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

/**
 * How this browser reaches the instance, what the instance says back, and how
 * to forget it. The endpoint and the key are local to this browser; the
 * instance below them is what the server itself reports.
 */
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

        <SettingsPageHead title="Connection" />

        {form.error && (
          <div className={styles.alertError}>
            <AlertTriangle size={15} />
            <span>{form.error}</span>
          </div>
        )}

        <form onSubmit={form.save}>
          <SettingsSection title="Endpoint">
            <SettingsRow label="Name" htmlFor="server-name">
              <input
                id="server-name"
                className={ledger.field}
                type="text"
                value={form.name}
                onChange={(event) => form.setName(event.target.value)}
                placeholder="Production US-East"
                required
              />
            </SettingsRow>

            <SettingsRow label="URL" htmlFor="server-url">
              <input
                id="server-url"
                className={`${ledger.field} ${ledger.fieldMono}`}
                type="text"
                value={form.url}
                onChange={(event) => form.setUrl(event.target.value)}
                placeholder="http://localhost:8090"
                required
              />
            </SettingsRow>

            <SettingsRow
              label="API key"
              htmlFor="server-key"
              help="Every request this browser makes is signed with it."
            >
              <div className={passwordStyles.wrapper}>
                <input
                  id="server-key"
                  className={`${ledger.field} ${ledger.fieldMono}`}
                  type={showKey ? 'text' : 'password'}
                  value={form.apiKey}
                  onChange={(event) => form.setApiKey(event.target.value)}
                  placeholder="silo_…"
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
            </SettingsRow>

            <div className={ledger.sectionActions}>
              {form.saved && <span className={`${ledger.sectionNote} ${ledger.noteOk}`}>Saved</span>}
              <Button
                type="button"
                variant="secondary"
                onClick={form.test}
                disabled={form.testing || form.saving}
              >
                <Activity size={14} />
                <span>{form.testing ? 'Testing…' : 'Test'}</span>
              </Button>
              <Button type="submit" variant="primary" disabled={form.saving || form.testing}>
                {form.saving ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </SettingsSection>
        </form>

        <SettingsSection
          title="Instance"
          hint={form.facts.version ? `v${form.facts.version}` : undefined}
        >
          <SettingsRow label="Reachability" inline>
            {form.status === 'online' ? (
              <span className={`${ledger.status} ${ledger.statusOk}`}>
                <span className={ledger.statusDot} />
                Connected{form.pingMs != null ? ` · ${form.pingMs}ms` : ''}
              </span>
            ) : form.status === 'error' ? (
              <span className={`${ledger.status} ${ledger.statusBad}`}>
                <span className={ledger.statusDot} />
                {form.statusMessage || 'Unreachable'}
              </span>
            ) : (
              <span className={`${ledger.status} ${ledger.statusIdle}`}>Checking…</span>
            )}
          </SettingsRow>

          <SettingsRow label="Key in use" inline>
            <span className={ledger.status}>
              {form.facts.sessionLabel
                ? `${form.facts.sessionLabel} · ${form.facts.keyPrefix}`
                : form.facts.keyPrefix || '—'}
            </span>
          </SettingsRow>

          {form.facts.claims.length > 0 && (
            <SettingsRow label="Grants" inline>
              <div className={ledger.chips}>
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
            </SettingsRow>
          )}
        </SettingsSection>

        <DestructiveSection>
          <DestructiveRow
            title="Forget this server"
            blast={
              <>
                Removes <strong>{server.name}</strong> from this browser's saved connections.
                Everything hosted on the instance stays exactly as it is.
              </>
            }
          >
            <Button type="button" variant="danger" onClick={() => setIsConfirmingDelete(true)}>
              Forget server
            </Button>
          </DestructiveRow>
        </DestructiveSection>
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
                <b>{server.name}</b> is removed from this browser's saved connections. Everything
                hosted on the instance itself stays exactly as it is.
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
