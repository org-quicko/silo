import { Globe, Server as ServerIcon, Settings } from 'lucide-react'
import { BrowserColumn } from './BrowserColumn'
import { ColumnItem } from './ColumnItem'
import { ColumnPlaceholder } from './ColumnPlaceholder'
import type { Server } from './server'
import styles from './ServerManager.module.css'

interface Props {
  servers: Server[]
  selectedId: string | null
  onSelect: (id: string) => void
  onOpenStatus: (id: string) => void
}

/** The first column: which silo instance to talk to. */
export function ServerColumn({ servers, selectedId, onSelect, onOpenStatus }: Props) {
  return (
    <BrowserColumn icon={ServerIcon} title="Servers" count={servers.length} active>
      {servers.length === 0 ? (
        <ColumnPlaceholder
          icon={Globe}
          message="No servers configured"
          hint='Click "Add Server" above to connect'
        />
      ) : (
        servers.map((server, index) => (
          <ColumnItem
            key={server.id}
            title={server.name}
            subtitle={server.url}
            selected={server.id === selectedId}
            index={index}
            chevron
            onSelect={() => onSelect(server.id)}
            action={
              <button
                type="button"
                className={styles.itemSettings}
                onClick={(event) => {
                  event.stopPropagation()
                  onOpenStatus(server.id)
                }}
                title="Server status & configuration"
              >
                <Settings size={13} />
              </button>
            }
          />
        ))
      )}
    </BrowserColumn>
  )
}
