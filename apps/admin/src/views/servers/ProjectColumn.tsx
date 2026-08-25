import { FolderGit2 } from 'lucide-react'
import { useState } from 'react'
import { BrowserColumn } from './BrowserColumn'
import { ColumnItem } from './ColumnItem'
import { ColumnPlaceholder } from './ColumnPlaceholder'
import { InlineNameForm } from './InlineNameForm'
import styles from './ServerManager.module.css'

interface Props {
  /** Null until a server is chosen — the column is inert until then. */
  serverId: string | null
  projects: string[]
  selected: string | null
  loading: boolean
  onSelect: (project: string) => void
  onCreate: (project: string) => Promise<void>
}

/** The second column: which project within the chosen server. */
export function ProjectColumn({
  serverId,
  projects,
  selected,
  loading,
  onSelect,
  onCreate,
}: Props) {
  const [adding, setAdding] = useState(false)

  const create = async (name: string) => {
    await onCreate(name).then(() => setAdding(false)).catch(() => {})
  }

  return (
    <BrowserColumn
      icon={FolderGit2}
      title="Projects"
      count={serverId ? projects.length : undefined}
      active={Boolean(serverId)}
      onAdd={serverId && !adding ? () => setAdding(true) : undefined}
      addTitle="New project"
    >
      {!serverId ? (
        <ColumnPlaceholder
          icon={FolderGit2}
          message="Select a server"
          hint="Projects will appear here"
        />
      ) : loading ? (
        <ColumnPlaceholder loading message="Loading projects…" />
      ) : (
        <div className={styles.animatedList} key={serverId}>
          {adding && (
            <InlineNameForm
              placeholder="project-name"
              onSubmit={create}
              onCancel={() => setAdding(false)}
            />
          )}
          {projects.length === 0 && !adding ? (
            <ColumnPlaceholder message="No projects found" hint="Click + to create one" />
          ) : (
            projects.map((project, index) => (
              <ColumnItem
                key={project}
                title={project}
                selected={project === selected}
                index={index}
                chevron
                onSelect={() => onSelect(project)}
              />
            ))
          )}
        </div>
      )}
    </BrowserColumn>
  )
}
