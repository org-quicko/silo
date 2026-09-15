import { useEffect, useState } from 'react'
import { api } from '../../api/silo-api'
import type { KeyView } from '../../api/types/key-view'
import type { ScopeRef } from '../../api/types/scope-ref'
import { Breadcrumb } from '../../components/navigation/Breadcrumb'
import { LoadingState } from '../../components/feedback/LoadingState'
import { TopBar } from '../shell/TopBar'
import { KeyFormView } from './KeyForm'

interface Props {
  keyId: string
  url: string
  apiKey: string
  scope: ScopeRef | null
  ownClaims: string[]
  keysUrl: string
  onCancel: () => void
  onDone: () => void
}

/**
 * Loads the key being edited, then hands it to the form.
 *
 * Separate from the form because the form takes its initial claim list as a
 * value and derives which tab can hold it once — a form that had to cope with
 * that list arriving later would need every tab to survive being reseeded
 * mid-edit, which is a much larger promise than "the page waits".
 *
 * Read from the list rather than a by-id route, because there is none: keys are
 * listed and revoked, and adding a read route to serve one page would widen the
 * API for the convenience of a screen that already has the record.
 */
export function KeyEditPage({
  keyId,
  url,
  apiKey,
  scope,
  ownClaims,
  keysUrl,
  onCancel,
  onDone,
}: Props) {
  const [subject, setSubject] = useState<KeyView | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    setSubject(null)
    setError('')
    api.keys
      .list(url, apiKey)
      .then((keys) => {
        if (!alive) return
        const found = keys.find((key) => key.id === keyId)
        if (found) setSubject(found)
        else setError('That key no longer exists.')
      })
      .catch((caught: any) => alive && setError(caught.message || 'Failed to load the key.'))
    return () => {
      alive = false
    }
  }, [url, apiKey, keyId])

  if (subject) {
    return (
      <KeyFormView
        url={url}
        apiKey={apiKey}
        scope={scope}
        ownClaims={ownClaims}
        subject={subject}
        keysUrl={keysUrl}
        onCancel={onCancel}
        onDone={onDone}
      />
    )
  }

  return (
    <>
      <TopBar />
      <div className="content">
        <Breadcrumb crumbs={[{ label: 'API keys', to: keysUrl }, { label: 'Edit key' }]} />
        {error ? <div className="banner banner-bad"><span>{error}</span></div> : <LoadingState message="Loading the key" />}
      </div>
    </>
  )
}
