import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../../api/silo-api'
import type { PluginPanelSource } from '../../../api/types/plugin-view'
import { pluginPanelDocument } from './plugin-panel-preamble'
import { PANEL_PROTOCOL, isRefusal, readPanelMessage } from './plugin-panel-protocol'

/** The theme variables a panel is handed. The admin's own tokens, read from the
 *  live document so a custom accent or light mode reaches a panel without this
 *  list knowing which theme is on. */
const THEME_TOKENS = [
  '--bg',
  '--board',
  '--panel',
  '--panel-2',
  '--line',
  '--line-2',
  '--text',
  '--text-2',
  '--text-3',
  '--accent',
  '--accent-ink',
  '--accent-soft',
  '--ok',
  '--warn',
  '--bad',
  '--font-ui',
  '--font-mono',
  '--radius',
  '--radius-sm',
] as const

/** How tall a panel may ask to be *on the page*. A panel measures its own
 *  content and the admin owns the page, so an unclamped request is a panel that
 *  can push every other control off the screen — including the grant that would
 *  let an operator turn it off. A panel with more to show than this is what
 *  `fill` is for: it gets the viewport and scrolls inside itself, which costs
 *  the page nothing. */
const MIN_HEIGHT = 160
const MAX_HEIGHT = 2400

/**
 * A plugin's panel, rendered (D41).
 *
 * Three properties, and each is one line of JSX or one guard below rather than a
 * policy stated elsewhere:
 *
 * - **`sandbox="allow-scripts"` and no `allow-same-origin`.** The panel gets an
 *   opaque origin, so it cannot read this app's `localStorage` — which holds an
 *   API key for every server the operator has configured — and cannot reach into
 *   this document. Keeping both tokens off one attribute is the entire isolation
 *   story, which is why it is written literally and not composed.
 * - **`srcdoc`, never `src`.** A `src` pointing at the API would put plugin HTML
 *   on silo's own origin, where the admin lives. The bytes arrive as JSON from
 *   `GET /api/plugins/{name}/ui` and become a document only here.
 * - **`event.source` identity, not origin.** An opaque origin posts as `"null"`,
 *   which every sandboxed frame shares, so the frame's own `contentWindow` is
 *   the only unforgeable identity available.
 */
export function PluginPanelFrame({
  plugin,
  url,
  apiKey,
  panel,
  scope,
  fill = false,
}: {
  plugin: string
  url: string
  apiKey: string
  panel: PluginPanelSource
  scope: { project: string; env: string } | null
  /** Take the height of whatever contains this instead of the height the panel
   *  asked for. The maximised case: the container is the viewport, so the
   *  panel's own scrollbar is the only one and the request is ignored rather
   *  than clamped. */
  fill?: boolean
}) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(MIN_HEIGHT)
  const [refusal, setRefusal] = useState('')

  /**
   * Read once per mount, not per render.
   *
   * `getComputedStyle` on the document element is a layout read, and rebuilding
   * `srcdoc` on every render would also reload the panel — losing whatever the
   * operator had typed into it. A theme change mid-session therefore does not
   * retint an open panel, which is the right trade: reloading a form under
   * somebody's hands to correct a colour is worse than the colour.
   */
  const document_ = useMemo(() => {
    const computed = getComputedStyle(window.document.documentElement)
    const theme: Record<string, string> = {}
    for (const token of THEME_TOKENS) {
      const value = computed.getPropertyValue(token).trim()
      if (value) theme[token] = value
    }
    return pluginPanelDocument({ plugin, html: panel.html, theme, scope })
  }, [plugin, panel.html, scope])

  useEffect(() => {
    const onMessage = async (event: MessageEvent) => {
      const target = frame.current?.contentWindow
      if (!target || event.source !== target) return

      const message = readPanelMessage(event.data, plugin)
      if (isRefusal(message)) {
        // Reported in the admin and not only to the panel, because every refusal
        // here is either a plugin author's bug or a panel reaching outside its
        // namespace — and the second is something the operator running it should
        // be told about rather than a line in a console they never opened.
        setRefusal(message.refused)
        const id = (event.data as { id?: unknown })?.id
        if (typeof id === 'string') {
          target.postMessage(
            { silo: PANEL_PROTOCOL, kind: 'error', id, message: message.refused },
            '*',
          )
        }
        return
      }

      if (message.kind === 'ready') return
      if (message.kind === 'height') {
        setHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, message.height)))
        return
      }

      try {
        const answer = await api.plugins.relay(url, apiKey, message)
        target.postMessage(
          {
            silo: PANEL_PROTOCOL,
            kind: 'response',
            id: message.id,
            status: answer.status,
            ok: answer.ok,
            headers: answer.headers,
            bytes: answer.bytes,
          },
          '*',
          // The bytes are transferred rather than copied: a panel that just
          // uploaded a database is holding a buffer this size already, and a
          // structured-clone copy of the answer would double a megabyte for no
          // reader on this side.
          [answer.bytes.buffer],
        )
      } catch (caught: any) {
        target.postMessage(
          {
            silo: PANEL_PROTOCOL,
            kind: 'error',
            id: message.id,
            message: caught?.message || 'the request did not complete',
          },
          '*',
        )
      }
    }

    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [plugin, url, apiKey])

  return (
    <>
      {refusal && (
        <div className="banner banner-bad">
          <span>
            This panel sent something the admin refused: {refusal}
          </span>
        </div>
      )}
      <iframe
        ref={frame}
        title={panel.title}
        srcDoc={document_}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        style={{ width: '100%', height: fill ? '100%' : height, border: 0, display: 'block' }}
      />
    </>
  )
}
