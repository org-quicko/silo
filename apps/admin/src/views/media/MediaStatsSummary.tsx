import type { MediaKindName, MediaStats } from '../../api/types/media-stats'
import { ByteSize } from '../../utils/byte-size'
import { Formatters } from '../../utils/formatters'
import styles from './MediaStats.module.css'

const KindLabels: Record<MediaKindName, string> = {
  image: 'Images',
  video: 'Video',
  audio: 'Audio',
  document: 'Documents',
  other: 'Other',
}

/** Three headline tiles, the split by kind as a table with a share meter per
 *  row, and the facts that do not fit a tile. */
export function MediaStatsSummary({ stats }: { stats: MediaStats }) {
  const tiles = [
    { label: 'Files', value: stats.files.toLocaleString() },
    { label: 'Total size', value: ByteSize.format(stats.bytes) },
    { label: 'Folders', value: stats.folders.toLocaleString() },
  ]

  return (
    <>
      <div className={styles.tiles}>
        {tiles.map((tile) => (
          <div key={tile.label} className={styles.tile}>
            <span className={styles.tileLabel}>{tile.label}</span>
            <span className={styles.tileValue}>{tile.value}</span>
          </div>
        ))}
      </div>

      {stats.types.length > 0 && (
        <table className={styles.types}>
          <caption className={styles.caption}>By type, as a share of the total size</caption>
          <thead>
            <tr>
              <th scope="col">Type</th>
              <th scope="col">Files</th>
              <th scope="col">Size</th>
              <th scope="col" aria-label="Share" />
            </tr>
          </thead>
          <tbody>
            {stats.types.map((kind) => {
              const share = stats.bytes > 0 ? kind.bytes / stats.bytes : 0
              return (
                <tr key={kind.type} title={`${KindLabels[kind.type]}: ${kind.bytes.toLocaleString()} bytes`}>
                  <th scope="row">{KindLabels[kind.type]}</th>
                  <td>{kind.files.toLocaleString()}</td>
                  <td>{ByteSize.format(kind.bytes)}</td>
                  <td>
                    <span className={styles.meter}>
                      <span className={styles.meterTrack}>
                        <span className={styles.meterFill} style={{ width: `${Math.max(share * 100, 1)}%` }} />
                      </span>
                      <span className={styles.meterValue}>{Math.round(share * 100)}%</span>
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      <dl className={styles.facts}>
        {stats.largest && (
          <div>
            <dt>Largest file</dt>
            <dd title={`${stats.largest.folder}/${stats.largest.filename}`}>
              {stats.largest.filename}, {ByteSize.format(stats.largest.size)}
            </dd>
          </div>
        )}
        {stats.last_upload && (
          <div>
            <dt>Last upload</dt>
            <dd>{Formatters.fullDateTime(stats.last_upload)}</dd>
          </div>
        )}
        {stats.deleting > 0 && (
          <div>
            <dt>Being deleted</dt>
            <dd>{stats.deleting.toLocaleString()}, not counted above</dd>
          </div>
        )}
      </dl>
    </>
  )
}
