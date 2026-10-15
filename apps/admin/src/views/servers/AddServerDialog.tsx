import { Eye, EyeOff } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { api } from '../../api/silo-api'
import { Button } from '../../components/buttons/Button'
import passwordStyles from '../../components/controls/PasswordInput.module.css'
import type { Server } from './server'
import styles from './ServerManager.module.css'

interface Props {
  /** A saved server to edit in place, keeping its id. Absent when adding one. */
  server?: Server
  /** Shown from the first paint, for an edit opened because the server failed. */
  initialError?: string
  onSave: (server: Server) => void
  /** Removes the edited server from this browser. Offered only when editing. */
  onForget?: () => void
  onClose: () => void
}

/**
 * Connection details for a running silo, verified before they are remembered.
 *
 * Given a `server`, the same form edits it: the picker opens it this way when
 * the saved key is refused, so the key can be replaced where it failed, or the
 * server forgotten without fixing it first. Forgetting asks once, in the
 * actions row, as Settings' Forget server does: it destroys nothing on the
 * instance, but the saved key goes with it.
 */
export function AddServerDialog({ server, initialError = '', onSave, onForget, onClose }: Props) {
  const editing = server !== undefined
  const [name, setName] = useState(server?.name ?? '')
  const [url, setUrl] = useState(server?.url ?? '')
  const [apiKey, setApiKey] = useState(server?.apiKey ?? '')
  const [showKey, setShowKey] = useState(false)
  const [error, setError] = useState(initialError)
  const [connecting, setConnecting] = useState(false)
  const [confirmingForget, setConfirmingForget] = useState(false)
  const keyInput = useRef<HTMLInputElement>(null)

  // An edit is almost always a new key, so the old one is selected and the
  // first keystroke replaces it.
  useEffect(() => {
    if (editing) keyInput.current?.select()
  }, [editing])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')

    const trimmedName = name.trim()
    const trimmedKey = apiKey.trim()
    let trimmedUrl = url.trim()
    if (!trimmedName || !trimmedUrl || !trimmedKey) {
      setError('Please fill in all required fields.')
      return
    }
    // A bare host is the common case; assume the unencrypted scheme rather than
    // failing on a URL the user plainly meant.
    if (!trimmedUrl.startsWith('http://') && !trimmedUrl.startsWith('https://')) {
      trimmedUrl = `http://${trimmedUrl}`
    }

    setConnecting(true)
    try {
      const verified = await api.session.verify(trimmedUrl, trimmedKey)
      if (!verified.ok) {
        setError('Verification failed: Invalid API key.')
        return
      }
      onSave({
        id: server?.id ?? Array.from(crypto.getRandomValues(new Uint8Array(8)), (byte) => byte.toString(16).padStart(2, '0')).join(''),
        name: trimmedName,
        url: trimmedUrl,
        apiKey: trimmedKey,
      })
    } catch (failure: any) {
      setError(`Failed to connect: ${failure.message || 'Connection refused.'}`)
    } finally {
      setConnecting(false)
    }
  }

  return (
    <div
      className={styles.modalOverlay}
      onClick={onClose}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className={styles.modal} onClick={(event) => event.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2>{editing ? 'Edit Silo Server' : 'Add Silo Server'}</h2>
          <button type="button" className={styles.modalClose} onClick={onClose}>
            ×
          </button>
        </div>
        <p className={styles.modalSubtitle}>
          {editing
            ? 'Update the connection details for this server.'
            : 'Enter connection details for your running Silo server.'}
        </p>

        <form onSubmit={submit} className={styles.modalForm}>
          <div className={styles.inputGroup}>
            <label htmlFor="server-name">
              Server Name <span className={styles.required}>*</span>
            </label>
            <input
              id="server-name"
              type="text"
              placeholder="e.g. Local Dev"
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={connecting}
              required
              autoFocus={!editing}
            />
          </div>

          <div className={styles.inputGroup}>
            <label htmlFor="server-url">
              Server URL <span className={styles.required}>*</span>
            </label>
            <input
              id="server-url"
              type="text"
              placeholder="e.g. http://localhost:8090"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              disabled={connecting}
              required
            />
          </div>

          <div className={styles.inputGroup}>
            <label htmlFor="server-key">
              API Key <span className={styles.required}>*</span>
            </label>
            <div className={passwordStyles.wrapper}>
              <input
                ref={keyInput}
                id="server-key"
                type={showKey ? 'text' : 'password'}
                placeholder="silo_..."
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                disabled={connecting}
                required
                autoFocus={editing}
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

          {error && (
            <div className={styles.modalError}>
              <span>{error}</span>
            </div>
          )}

          {confirmingForget ? (
            <div className={styles.modalActions}>
              <span className={styles.modalConfirm}>Remove from this browser only?</span>
              <Button type="button" variant="secondary" onClick={() => setConfirmingForget(false)}>
                Keep
              </Button>
              <Button type="button" variant="danger" onClick={onForget}>
                Forget server
              </Button>
            </div>
          ) : (
            <div className={styles.modalActions}>
              {editing && onForget && (
                <Button
                  type="button"
                  variant="dangerGhost"
                  className={styles.modalActionsLead}
                  onClick={() => setConfirmingForget(true)}
                  disabled={connecting}
                >
                  Forget server
                </Button>
              )}
              <Button type="button" variant="secondary" onClick={onClose} disabled={connecting}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={connecting}>
                {connecting ? 'Connecting...' : editing ? 'Save' : 'Add Server'}
              </Button>
            </div>
          )}
        </form>
      </div>
    </div>
  )
}
