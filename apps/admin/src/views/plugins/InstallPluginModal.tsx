import { useState, useRef, type FormEvent, type DragEvent } from 'react'
import { AlertCircle, Download, FileArchive, Info, Package, UploadCloud } from 'lucide-react'
import { api } from '../../api/silo-api'
import type { PluginInstallResponse } from '../../api/types/plugin-install'
import { Button } from '../../components/buttons/Button'
import { Modal } from '../../components/modal/Modal'
import { ModalActions } from '../../components/modal/ModalActions'
import { ModalBody } from '../../components/modal/ModalBody'
import { ModalCopy } from '../../components/modal/ModalCopy'
import { ModalHeader } from '../../components/modal/ModalHeader'
import { ModalIcon } from '../../components/modal/ModalIcon'
import { Segmented } from '../../components/controls/Segmented'
import { Toggle } from '../../components/controls/Toggle'
import styles from './InstallPluginModal.module.css'

/**
 * Install a plugin from the admin, which since D42 is the whole of it — the
 * package is fetched, checked, started and granted by the time this closes.
 *
 * Claims are deliberately **not** offered here. `POST /api/plugins/install`
 * defaults to exactly what the package says it requires, and narrowing that is
 * a decision to make on the plugin's own screen, against the reasons its
 * manifest gives for each claim. A claims picker on this dialog would ask the
 * operator to approve a list before there is anything to read it against.
 */
export function InstallPluginModal({
  url,
  apiKey,
  onClose,
  onSuccess,
}: {
  url: string
  apiKey: string
  onClose: () => void
  onSuccess: (result: PluginInstallResponse) => void
}) {
  const [mode, setMode] = useState<'spec' | 'file'>('spec')
  const [spec, setSpec] = useState('')
  const [ref, setRef] = useState('')
  const [integrity, setIntegrity] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [force, setForce] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // An install that succeeded with something to say stays open holding it. The
  // warnings are the cases where the plugin is *not* simply running — a provider
  // that waits for the next start, a config file that could not be written — and
  // navigating away from them would drop the one notice that explains the screen
  // the operator lands on.
  const [installed, setInstalled] = useState<PluginInstallResponse | null>(null)

  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const accept = (file: File) => {
    if (!/\.(tgz|tar\.gz|tar)$/i.test(file.name)) {
      setError('Please select a .tgz or .tar.gz archive file.')
      return
    }
    setSelectedFile(file)
    setError('')
  }

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]
    if (file) accept(file)
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')

    if (mode === 'spec' && !spec.trim()) {
      setError('Please provide a package spec, git URL, or archive URL.')
      return
    }
    if (mode === 'file' && !selectedFile) {
      setError('Please choose a .tgz archive file to upload.')
      return
    }

    setBusy(true)
    try {
      const result =
        mode === 'spec'
          ? await api.plugins.install(url, apiKey, {
              spec: spec.trim(),
              ref: ref.trim() || undefined,
              integrity: integrity.trim() || undefined,
              force,
            })
          : await api.plugins.installArchive(url, apiKey, selectedFile!, {
              force,
              integrity: integrity.trim() || undefined,
            })

      if (result.warnings?.length) setInstalled(result)
      else onSuccess(result)
    } catch (caught: any) {
      setError(caught?.message || 'Failed to install plugin.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal onClose={busy ? () => {} : onClose} size="lg">
      <form onSubmit={handleSubmit}>
        <ModalHeader>
          <ModalIcon tone="ok">
            <Download size={20} />
          </ModalIcon>
          <ModalCopy>
            <h3>Install a plugin</h3>
            <ModalBody>
              The package is fetched, checked and started here — no restart, no terminal. It is
              listed in <code>silo.toml</code> and granted the claims its manifest says it
              requires, which you can narrow or withdraw afterwards.
            </ModalBody>
          </ModalCopy>
        </ModalHeader>

        <div className={styles.body}>
          {installed ? (
            <div className={styles.noticeBanner}>
              <Info size={15} />
              <div>
                <b>{installed.name} was installed.</b>
                <ul>
                  {installed.warnings?.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            </div>
          ) : (
            <>
          <div className={styles.modeSwitch}>
            <Segmented
              value={mode}
              onChange={(next) => {
                setMode(next)
                setError('')
              }}
              options={[
                { value: 'spec', label: <><Package size={14} /> Package spec / URL</> },
                { value: 'file', label: <><UploadCloud size={14} /> Upload archive (.tgz)</> },
              ]}
            />
          </div>

          {error && (
            <div className={styles.errorBanner}>
              <AlertCircle size={15} />
              <span>{error}</span>
            </div>
          )}

          {mode === 'spec' ? (
            <>
              <div className={styles.field}>
                <label htmlFor="plugin-spec">Package spec or URL</label>
                <input
                  id="plugin-spec"
                  type="text"
                  className={`${styles.input} ${styles.inputMono}`}
                  placeholder="e.g. @acme/silo-plugin-slug@^1 or https://... or git+https://..."
                  value={spec}
                  onChange={(e) => setSpec(e.target.value)}
                  disabled={busy}
                  autoFocus
                />
                <span className={styles.hint}>
                  Supports npm registry package specs, HTTPS tarball URLs, Git repositories, or local paths.
                </span>
              </div>

              <div className={styles.field}>
                <label htmlFor="plugin-ref">Git branch or ref (optional)</label>
                <input
                  id="plugin-ref"
                  type="text"
                  className={`${styles.input} ${styles.inputMono}`}
                  placeholder="main or v1.2.0"
                  value={ref}
                  onChange={(e) => setRef(e.target.value)}
                  disabled={busy}
                />
              </div>

              <div className={styles.field}>
                <label htmlFor="plugin-integrity">SRI integrity digest (optional)</label>
                <input
                  id="plugin-integrity"
                  type="text"
                  className={`${styles.input} ${styles.inputMono}`}
                  placeholder="sha512-..."
                  value={integrity}
                  onChange={(e) => setIntegrity(e.target.value)}
                  disabled={busy}
                />
              </div>
            </>
          ) : (
            <>
              <div className={styles.field}>
                <label>Plugin archive (.tgz / .tar.gz)</label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".tgz,.tar.gz,.tar,application/gzip,application/x-tar"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) accept(file)
                  }}
                  disabled={busy}
                />
                {/* A button and not a div: it is the control that opens the file
                    picker, so it has to be reachable and operable from the
                    keyboard. Dropping is the shortcut on top of it. */}
                <button
                  type="button"
                  className={`${styles.dropzone} ${selectedFile ? styles.fileActive : ''}`}
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={handleDrop}
                  disabled={busy}
                >
                  {selectedFile ? (
                    <div className={styles.fileInfo}>
                      <FileArchive size={20} />
                      <span>{selectedFile.name}</span>
                      <span className={styles.fileSize}>({formatFileSize(selectedFile.size)})</span>
                    </div>
                  ) : (
                    <>
                      <UploadCloud size={24} />
                      <span>Click to select or drag and drop a plugin archive (.tgz)</span>
                    </>
                  )}
                </button>
              </div>

              <div className={styles.field}>
                <label htmlFor="plugin-file-integrity">SRI integrity digest (optional)</label>
                <input
                  id="plugin-file-integrity"
                  type="text"
                  className={`${styles.input} ${styles.inputMono}`}
                  placeholder="sha512-..."
                  value={integrity}
                  onChange={(e) => setIntegrity(e.target.value)}
                  disabled={busy}
                />
              </div>
            </>
          )}

          <div className={styles.toggleRow}>
            <div className={styles.toggleLabel}>
              <b>Force overwrite</b>
              <span>Replaces an existing installation of the same name.</span>
            </div>
            <Toggle on={force} onChange={setForce} disabled={busy} size="sm" />
          </div>
            </>
          )}
        </div>

        <ModalActions>
          {installed ? (
            <Button variant="primary" type="button" onClick={() => onSuccess(installed)}>
              Done
            </Button>
          ) : (
            <>
              {/* `type="button"` because `Button` renders a bare <button>, and a
                  bare one inside a <form> submits it — Cancel would install. */}
              <Button variant="secondary" type="button" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button variant="primary" type="submit" disabled={busy}>
                {busy ? 'Installing…' : 'Install plugin'}
              </Button>
            </>
          )}
        </ModalActions>
      </form>
    </Modal>
  )
}
