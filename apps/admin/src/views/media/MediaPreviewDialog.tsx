import { useEffect, useState, useMemo } from 'react'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Folder,
  Hash,
  Music,
  X,
  WrapText,
  ZoomIn,
  ZoomOut,
  Maximize2,
} from 'lucide-react'
import type { MediaAsset } from '../../api/types/media-asset'
import { ByteSize } from '../../utils/byte-size'
import { Formatters } from '../../utils/formatters'
import { ToastManager } from '../../utils/toast-manager'
import { MediaFileUrl } from './media-file-url'
import styles from './MediaLibrary.module.css'

interface Props {
  asset: MediaAsset
  assets: MediaAsset[]
  baseUrl: string
  onClose: () => void
  onNavigate?: (asset: MediaAsset) => void
}

type MediaType = 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'other'

function detectMediaType(asset: MediaAsset): MediaType {
  const type = asset.content_type.toLowerCase()
  const name = asset.filename.toLowerCase()

  if (type.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg|avif|ico|bmp)$/i.test(name)) return 'image'
  if (type.startsWith('video/') || /\.(mp4|webm|ogg|mov|m4v)$/i.test(name)) return 'video'
  if (type.startsWith('audio/') || /\.(mp3|wav|ogg|aac|m4a|flac)$/i.test(name)) return 'audio'
  if (type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf'
  if (
    type.startsWith('text/') ||
    type === 'application/json' ||
    type === 'application/xml' ||
    type === 'application/javascript' ||
    type === 'application/typescript' ||
    /\.(txt|md|json|csv|log|yaml|yml|xml|html|css|js|jsx|ts|tsx|sh|sql)$/i.test(name)
  ) {
    return 'text'
  }
  return 'other'
}

export function MediaPreviewDialog({ asset, assets, baseUrl, onClose, onNavigate }: Props) {
  const [copied, setCopied] = useState(false)
  const [copiedText, setCopiedText] = useState(false)
  const [textContent, setTextContent] = useState<string | null>(null)
  const [textLoading, setTextLoading] = useState(false)
  const [textError, setTextError] = useState('')
  const [wordWrap, setWordWrap] = useState(true)
  const [zoom, setZoom] = useState(1)
  const [imgDimensions, setImgDimensions] = useState<{ width: number; height: number } | null>(null)

  const fileUrl = MediaFileUrl.of(asset, baseUrl)
  const mediaType = detectMediaType(asset)
  const currentIndex = assets.findIndex((a) => a.id === asset.id)
  const hasPrev = currentIndex > 0
  const hasNext = currentIndex >= 0 && currentIndex < assets.length - 1

  const goPrev = () => {
    if (hasPrev && onNavigate) onNavigate(assets[currentIndex - 1])
  }

  const goNext = () => {
    if (hasNext && onNavigate) onNavigate(assets[currentIndex + 1])
  }

  // Keyboard navigation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft') goPrev()
      else if (e.key === 'ArrowRight') goNext()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [hasPrev, hasNext, currentIndex, assets, onClose])

  // Reset zoom & dimensions on asset change
  useEffect(() => {
    setZoom(1)
    setImgDimensions(null)
  }, [asset.id])

  // Fetch text/code content when needed
  useEffect(() => {
    if (mediaType !== 'text') {
      setTextContent(null)
      setTextLoading(false)
      setTextError('')
      return
    }

    setTextLoading(true)
    setTextError('')
    const controller = new AbortController()

    fetch(fileUrl, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.text()
      })
      .then((text) => {
        if (asset.filename.endsWith('.json') || asset.content_type === 'application/json') {
          try {
            setTextContent(JSON.stringify(JSON.parse(text), null, 2))
          } catch {
            setTextContent(text)
          }
        } else {
          setTextContent(text)
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setTextError(err.message || 'Failed to fetch content')
        }
      })
      .finally(() => setTextLoading(false))

    return () => controller.abort()
  }, [fileUrl, mediaType, asset.filename, asset.content_type])

  const copyUrl = () => {
    navigator.clipboard.writeText(fileUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
    ToastManager.show('Link copied')
  }

  const copyFileText = () => {
    if (!textContent) return
    navigator.clipboard.writeText(textContent)
    setCopiedText(true)
    setTimeout(() => setCopiedText(false), 1500)
    ToastManager.show('Text copied')
  }

  const textLines = useMemo(() => {
    if (textContent === null) return []
    return textContent.split('\n')
  }, [textContent])

  return (
    <div className={styles.previewBackdrop} onMouseDown={onClose}>
      <div className={styles.previewContainer} onMouseDown={(e) => e.stopPropagation()}>
        {/* Top Header */}
        <div className={styles.previewHeader}>
          <div className={styles.previewTitleGroup}>
            {assets.length > 1 && (
              <div className={styles.previewNavGroup}>
                <button
                  type="button"
                  className={styles.previewNavButton}
                  onClick={goPrev}
                  disabled={!hasPrev}
                  title="Previous (Left Arrow)"
                  aria-label="Previous file"
                >
                  <ChevronLeft size={16} />
                </button>
                <span className={styles.previewIndex}>
                  {currentIndex + 1} / {assets.length}
                </span>
                <button
                  type="button"
                  className={styles.previewNavButton}
                  onClick={goNext}
                  disabled={!hasNext}
                  title="Next (Right Arrow)"
                  aria-label="Next file"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            )}
            <div className={styles.previewTitles}>
              <h3 className={styles.previewFilename} title={asset.filename}>
                {asset.filename}
              </h3>
              <div className={styles.previewMetaBadges}>
                <span className={styles.previewBadge}>{asset.content_type}</span>
                <span className={styles.previewBadge}>{ByteSize.format(asset.size)}</span>
                {imgDimensions && (
                  <span className={styles.previewBadge}>
                    {imgDimensions.width} × {imgDimensions.height} px
                  </span>
                )}
                {asset.folder && (
                  <span className={styles.previewBadge}>
                    <Folder size={11} /> {asset.folder}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className={styles.previewActions}>
            <button
              type="button"
              className={styles.previewActionButton}
              onClick={copyUrl}
              title="Copy public URL"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              <span>{copied ? 'Copied' : 'Copy URL'}</span>
            </button>
            <a
              href={fileUrl}
              download={asset.filename}
              className={styles.previewActionButton}
              title="Download file"
            >
              <Download size={14} />
              <span>Download</span>
            </a>
            <a
              href={fileUrl}
              target="_blank"
              rel="noreferrer"
              className={styles.previewActionButton}
              title="Open in new tab"
            >
              <ExternalLink size={14} />
            </a>
            <button
              type="button"
              className={styles.previewCloseButton}
              onClick={onClose}
              title="Close (Escape)"
              aria-label="Close preview"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Media Viewer Area */}
        <div className={styles.previewContent}>
          {mediaType === 'image' && (
            <div className={styles.imageViewerWrapper}>
              <div
                className={styles.imageViewerCanvas}
                style={{ transform: `scale(${zoom})` }}
              >
                <img
                  src={fileUrl}
                  alt={asset.filename}
                  onLoad={(e) => {
                    const img = e.currentTarget
                    setImgDimensions({ width: img.naturalWidth, height: img.naturalHeight })
                  }}
                />
              </div>
              <div className={styles.imageZoomBar}>
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))}
                  title="Zoom Out"
                >
                  <ZoomOut size={14} />
                </button>
                <span>{Math.round(zoom * 100)}%</span>
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.min(4, z + 0.25))}
                  title="Zoom In"
                >
                  <ZoomIn size={14} />
                </button>
                {zoom !== 1 && (
                  <button type="button" onClick={() => setZoom(1)} title="Reset zoom">
                    <Maximize2 size={13} />
                  </button>
                )}
              </div>
            </div>
          )}

          {mediaType === 'video' && (
            <div className={styles.videoViewerWrapper}>
              <video
                src={fileUrl}
                controls
                autoPlay
                playsInline
                className={styles.nativeVideo}
              >
                Your browser does not support HTML5 video playback.
              </video>
            </div>
          )}

          {mediaType === 'audio' && (
            <div className={styles.audioViewerWrapper}>
              <div className={styles.audioCard}>
                <div className={styles.audioIconWrap}>
                  <Music size={48} strokeWidth={1.5} />
                </div>
                <div className={styles.audioCardInfo}>
                  <h4 title={asset.filename}>{asset.filename}</h4>
                  <span>{ByteSize.format(asset.size)}</span>
                </div>
                <audio src={fileUrl} controls autoPlay className={styles.nativeAudio}>
                  Your browser does not support HTML5 audio playback.
                </audio>
              </div>
            </div>
          )}

          {mediaType === 'pdf' && (
            <div className={styles.pdfViewerWrapper}>
              <iframe src={fileUrl} title={asset.filename} className={styles.nativePdfIframe} />
            </div>
          )}

          {mediaType === 'text' && (
            <div className={styles.textViewerWrapper}>
              <div className={styles.textViewerToolbar}>
                <span className={styles.textLineCount}>{textLines.length} lines</span>
                <div className={styles.textViewerActions}>
                  <button
                    type="button"
                    className={`${styles.textToolbarButton} ${wordWrap ? styles.textToolbarActive : ''}`}
                    onClick={() => setWordWrap((w) => !w)}
                    title="Toggle word wrap"
                  >
                    <WrapText size={13} />
                    <span>Wrap</span>
                  </button>
                  <button
                    type="button"
                    className={styles.textToolbarButton}
                    onClick={copyFileText}
                    title="Copy text content"
                    disabled={!textContent}
                  >
                    {copiedText ? <Check size={13} /> : <Copy size={13} />}
                    <span>{copiedText ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
              </div>
              {textLoading && <div className={styles.textLoading}>Loading file contents…</div>}
              {textError && <div className={styles.textError}>Error loading preview: {textError}</div>}
              {textContent !== null && !textLoading && (
                <div className={`${styles.codeContainer} ${wordWrap ? styles.codeWrap : ''}`}>
                  <div className={styles.codeGutter}>
                    {textLines.map((_, i) => (
                      <span key={i}>{i + 1}</span>
                    ))}
                  </div>
                  <pre className={styles.codeBody}>
                    <code>{textContent}</code>
                  </pre>
                </div>
              )}
            </div>
          )}

          {mediaType === 'other' && (
            <div className={styles.otherViewerWrapper}>
              <div className={styles.otherCard}>
                <div className={styles.otherIconWrap}>
                  <FileText size={56} strokeWidth={1.2} />
                </div>
                <h3>{asset.filename}</h3>
                <p>Preview is not natively supported for this file format ({asset.content_type}).</p>
                <div className={styles.otherActions}>
                  <a href={fileUrl} download={asset.filename} className={styles.otherDownloadButton}>
                    <Download size={15} /> Download file
                  </a>
                  <a href={fileUrl} target="_blank" rel="noreferrer" className={styles.otherOpenButton}>
                    <ExternalLink size={15} /> Open in browser
                  </a>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Metadata Footer */}
        <div className={styles.previewFooter}>
          <div className={styles.previewFooterItem} title={`ID: ${asset.id}`}>
            <span className={styles.previewFooterLabel}>ID</span>
            <span className={styles.previewFooterValue}>{asset.id}</span>
          </div>
          {asset.hash && (
            <div className={styles.previewFooterItem} title={`SHA-256 Hash: ${asset.hash}`}>
              <Hash size={12} className={styles.previewFooterIcon} />
              <span className={styles.previewFooterValue}>{asset.hash.slice(0, 16)}…</span>
            </div>
          )}
          <div className={styles.previewFooterItem} title={new Date(asset.created_at).toLocaleString()}>
            <span className={styles.previewFooterLabel}>Created</span>
            <span className={styles.previewFooterValue}>{Formatters.relativeTime(asset.created_at)}</span>
          </div>
          <div className={styles.previewFooterItem} title={new Date(asset.updated_at).toLocaleString()}>
            <span className={styles.previewFooterLabel}>Modified</span>
            <span className={styles.previewFooterValue}>{Formatters.relativeTime(asset.updated_at)}</span>
          </div>
          {asset.usage_count !== undefined && asset.usage_count > 0 && (
            <div className={styles.previewFooterItem}>
              <span className={styles.previewFooterLabel}>Used in</span>
              <span className={styles.previewFooterValue}>
                {asset.usage_count} {asset.usage_count === 1 ? 'entry' : 'entries'}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
