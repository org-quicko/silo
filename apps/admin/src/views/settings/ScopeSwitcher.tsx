import React, { useEffect, useRef, useState } from 'react'
import { Check, ChevronsUpDown, Plus } from 'lucide-react'
import { Claims } from '@silo/shared/claims'
import styles from './ScopeSwitcher.module.css'

/**
 * The PROJECT / ENVIRONMENT context picker in the settings nav.
 *
 * Switching context is a navigation, not a form: `onSelect` swaps one path
 * segment and keeps the section, so moving from `acme`'s environments to
 * `other`'s lands on the same page for the other project. Creating is offered
 * here rather than on a list page of its own, because this is where the
 * question "which one am I configuring?" is already being asked.
 */
export function ScopeSwitcher({
  icon,
  label,
  options,
  value,
  loading,
  createLabel,
  onSelect,
  onCreate,
}: {
  icon: React.ReactNode
  label: string
  options: string[]
  value: string | null
  loading: boolean
  /** Omit to hide the create affordance (the key cannot create here). */
  createLabel?: string
  onSelect: (next: string) => void
  onCreate?: (id: string) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const root = useRef<HTMLDivElement>(null)

  function close() {
    setOpen(false)
    setCreating(false)
    setDraft('')
    setError('')
  }

  useEffect(() => {
    if (!open) return
    const onDocument = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onDocument)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocument)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const id = draft.trim()
    if (!id || !onCreate) return
    if (!Claims.isScopeId(id)) {
      setError('Lowercase letter first, then [a-z0-9_-], max 64 chars.')
      return
    }
    setBusy(true)
    setError('')
    try {
      await onCreate(id)
      close()
    } catch (caught: any) {
      setError(caught.message || 'Could not create it')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.root} ref={root}>
      <button
        type="button"
        className={styles.trigger}
        disabled={loading && !value}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
        title={`Switch ${label.toLowerCase()}`}
      >
        <span className={styles.triggerIcon}>{icon}</span>
        <span className={styles.triggerLabel}>{value || (loading ? 'Loading…' : `No ${label.toLowerCase()}`)}</span>
        <ChevronsUpDown size={13} className={styles.chevron} />
      </button>

      {open && (
        <div className={styles.menu} role="menu">
          {options.length === 0 && !loading && (
            <span className={styles.empty}>None on this server yet.</span>
          )}
          {options.map((option) => (
            <button
              key={option}
              type="button"
              role="menuitem"
              className={`${styles.option} ${option === value ? styles.optionActive : ''}`}
              onClick={() => {
                close()
                if (option !== value) onSelect(option)
              }}
            >
              <span className={styles.optionName}>{option}</span>
              {option === value && <Check size={13} className={styles.optionCheck} />}
            </button>
          ))}

          {onCreate && createLabel && (
            <>
              {options.length > 0 && <div className={styles.menuDivider} />}
              {creating ? (
                <form onSubmit={submit} className={styles.createForm}>
                  <input
                    type="text"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder={label.toLowerCase() === 'project' ? 'project-name' : 'env-name'}
                    disabled={busy}
                    autoFocus
                  />
                  <button type="submit" className={styles.createSubmit} disabled={busy || !draft.trim()} title="Create">
                    <Check size={13} />
                  </button>
                </form>
              ) : (
                <button
                  type="button"
                  role="menuitem"
                  className={`${styles.option} ${styles.create}`}
                  onClick={() => setCreating(true)}
                >
                  <Plus size={13} />
                  <span className={styles.optionName}>{createLabel}</span>
                </button>
              )}
              {error && <span className={styles.error}>{error}</span>}
            </>
          )}
        </div>
      )}
    </div>
  )
}
