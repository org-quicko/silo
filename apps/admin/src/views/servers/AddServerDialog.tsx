import { Eye, EyeOff } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { api } from '../../api/silo-api'
import { Button } from '../../components/buttons/Button'
import passwordStyles from '../../components/controls/PasswordInput.module.css'
import type { Server } from './server'
import styles from './ServerManager.module.css'

interface Props {
  onAdd: (server: Server) => void
  onClose: () => void
}

/** Connection details for a running silo, verified before it is remembered. */
export function AddServerDialog({ onAdd, onClose }: Props) {
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [error, setError] = useState('')
  const [connecting, setConnecting] = useState(false)

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
      onAdd({
        id: Math.random().toString(36).substring(2, 11),
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
          <h2>Add Silo Server</h2>
          <button type="button" className={styles.modalClose} onClick={onClose}>
            ×
          </button>
        </div>
        <p className={styles.modalSubtitle}>
          Enter connection details for your running Silo server.
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
              autoFocus
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
                id="server-key"
                type={showKey ? 'text' : 'password'}
                placeholder="silo_..."
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                disabled={connecting}
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

          {error && (
            <div className={styles.modalError}>
              <span>{error}</span>
            </div>
          )}

          <div className={styles.modalActions}>
            <Button type="button" variant="secondary" onClick={onClose} disabled={connecting}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={connecting}>
              {connecting ? 'Connecting...' : 'Add Server'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
