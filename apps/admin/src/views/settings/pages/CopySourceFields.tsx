import type { CopySourceMedia, CopySourceStatus } from './use-copy-source'
import { useCopySource } from './use-copy-source'

const KeyHint: Record<CopySourceStatus, string> = {
  local: '',
  waiting: 'Used for this copy only. Not saved.',
  checking: 'Checking the key…',
  ready: 'Key accepted.',
  refused: 'The source refused this key.',
  unreachable: 'Could not reach the source.',
}

/**
 * The source server, and for another server its key and media mode. Cells of
 * the page's source grid, so they sit beside project and environment.
 */
export function CopySourceFields({ source, busy }: { source: ReturnType<typeof useCopySource>; busy: boolean }) {
  const bad = source.status === 'refused' || source.status === 'unreachable'
  return (
    <>
      <div className="field">
        <label className="field-label" htmlFor="src-server">
          Source server
        </label>
        <select
          id="src-server"
          className="input"
          value={source.serverId}
          onChange={(event) => source.setServerId(event.target.value)}
          disabled={busy}
        >
          <option value={source.local}>This server</option>
          {source.servers.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </div>

      {source.remote && (
        <>
          <div className="field">
            <label className="field-label" htmlFor="src-key">
              Source API key
            </label>
            <input
              id="src-key"
              className="input"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={source.key}
              onChange={(event) => source.setKey(event.target.value)}
              disabled={busy}
            />
            <span className={`field-hint${bad ? ' warn' : ''}`}>{KeyHint[source.status]}</span>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="src-media">
              Media files
            </label>
            <select
              id="src-media"
              className="input"
              value={source.media}
              onChange={(event) => source.setMedia(event.target.value as CopySourceMedia)}
              disabled={busy}
            >
              <option value="referenced">Files the entries use</option>
              <option value="none">No files</option>
            </select>
          </div>
        </>
      )}
    </>
  )
}
