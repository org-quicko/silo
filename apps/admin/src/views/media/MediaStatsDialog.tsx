import { ChartPie } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../../api/silo-api'
import type { MediaStats } from '../../api/types/media-stats'
import { Button } from '../../components/buttons/Button'
import { LoadingState } from '../../components/feedback/LoadingState'
import { Modal } from '../../components/modal/Modal'
import { ModalActions } from '../../components/modal/ModalActions'
import { ModalBody } from '../../components/modal/ModalBody'
import { ModalCopy } from '../../components/modal/ModalCopy'
import { ModalError } from '../../components/modal/ModalError'
import { ModalHeader } from '../../components/modal/ModalHeader'
import { ModalIcon } from '../../components/modal/ModalIcon'
import { MediaLibraryError } from './media-library-error'
import { MediaStatsSummary } from './MediaStatsSummary'
import styles from './MediaStats.module.css'

interface Props {
  url: string
  apiKey: string
  onClose: () => void
}

/** Totals for the whole library, read fresh each time it opens (D106). */
export function MediaStatsDialog({ url, apiKey, onClose }: Props) {
  const [stats, setStats] = useState<MediaStats | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    api.media
      .stats(url, apiKey)
      .then((loaded) => live && setStats(loaded))
      .catch((failure) => live && setError(MediaLibraryError.message(failure, 'Could not load the stats')))
    return () => {
      live = false
    }
  }, [url, apiKey])

  return (
    <Modal onClose={onClose}>
      <ModalHeader>
        <ModalIcon tone="accent">
          <ChartPie size={20} />
        </ModalIcon>
        <ModalCopy>
          <h3>Library stats</h3>
          <ModalBody>Every file in the library, in all folders.</ModalBody>
        </ModalCopy>
      </ModalHeader>

      <div className={styles.content}>
        {error ? (
          <ModalError>{error}</ModalError>
        ) : stats ? (
          <MediaStatsSummary stats={stats} />
        ) : (
          <LoadingState message="Counting the library…" inline size="sm" />
        )}
      </div>

      <ModalActions>
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </ModalActions>
    </Modal>
  )
}
