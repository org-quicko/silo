import { Folder, Search } from 'lucide-react'
import { useState } from 'react'
import { BrowserColumn } from '../../components/browser/BrowserColumn'
import { ColumnItem } from '../../components/browser/ColumnItem'
import { ColumnPlaceholder } from '../../components/browser/ColumnPlaceholder'
import { ColumnSearch } from '../../components/browser/ColumnSearch'
import { InlineNameForm } from './InlineNameForm'
import styles from '../../components/browser/ScopeBrowser.module.css'

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
  const [query, setQuery] = useState('')
  const search = query.trim().toLowerCase()
  const matches = projects.filter((project) => project.toLowerCase().includes(search))

  const create = async (name: string) => {
    await onCreate(name).then(() => {
      setAdding(false)
      setQuery('')
    }).catch(() => {})
  }

  return (
    <BrowserColumn
      icon={Folder}
      title="Projects"
      count={serverId ? projects.length : undefined}
      resultCount={search && !loading ? matches.length : undefined}
      search={serverId && (
        <ColumnSearch label="Search projects" value={query} onChange={setQuery} disabled={loading} />
      )}
      active={Boolean(serverId)}
      onAdd={serverId && !adding ? () => setAdding(true) : undefined}
      addTitle="New project"
    >
      {!serverId ? (
        <ColumnPlaceholder
          icon={Folder}
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
          ) : search && matches.length === 0 ? (
            <ColumnPlaceholder icon={Search} message="No matching projects" hint="Try another name or clear the search" />
          ) : (
            matches.map((project, index) => (
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
