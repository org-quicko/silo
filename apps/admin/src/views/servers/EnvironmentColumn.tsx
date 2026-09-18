import { Layers, Search } from 'lucide-react'
import { useState } from 'react'
import { BrowserColumn } from '../../components/browser/BrowserColumn'
import { ColumnItem } from '../../components/browser/ColumnItem'
import { ColumnPlaceholder } from '../../components/browser/ColumnPlaceholder'
import { ColumnSearch } from '../../components/browser/ColumnSearch'
import { InlineNameForm } from './InlineNameForm'
import styles from '../../components/browser/ScopeBrowser.module.css'

interface Props {
  serverId: string | null
  project: string | null
  environments: string[]
  selected: string | null
  loading: boolean
  onSelect: (env: string) => void
  onCreate: (env: string) => Promise<void>
  /** Double-clicking an environment opens the workspace directly. */
  onActivate: () => void
}

/** The third column: which environment of the chosen project. */
export function EnvironmentColumn({
  serverId,
  project,
  environments,
  selected,
  loading,
  onSelect,
  onCreate,
  onActivate,
}: Props) {
  const [adding, setAdding] = useState(false)
  const [query, setQuery] = useState('')
  const search = query.trim().toLowerCase()
  const matches = environments.filter((env) => env.toLowerCase().includes(search))

  const create = async (name: string) => {
    await onCreate(name).then(() => {
      setAdding(false)
      setQuery('')
    }).catch(() => {})
  }

  return (
    <BrowserColumn
      icon={Layers}
      title="Environments"
      count={project ? environments.length : undefined}
      resultCount={search && !loading ? matches.length : undefined}
      search={serverId && project && (
        <ColumnSearch label="Search environments" value={query} onChange={setQuery} disabled={loading} />
      )}
      active={Boolean(project)}
      onAdd={project && !adding ? () => setAdding(true) : undefined}
      addTitle="New environment"
    >
      {!serverId ? (
        <ColumnPlaceholder icon={Layers} message="Select a server" />
      ) : !project ? (
        <ColumnPlaceholder
          icon={Layers}
          message="Select a project"
          hint="Environments will appear here"
        />
      ) : loading ? (
        <ColumnPlaceholder loading message="Loading environments…" />
      ) : (
        <div className={styles.animatedList} key={`${serverId}:${project}`}>
          {adding && (
            <InlineNameForm
              placeholder="env-name"
              onSubmit={create}
              onCancel={() => setAdding(false)}
            />
          )}
          {environments.length === 0 && !adding ? (
            <ColumnPlaceholder message="No environments found" hint="Click + to create one" />
          ) : search && matches.length === 0 ? (
            <ColumnPlaceholder icon={Search} message="No matching environments" hint="Try another name or clear the search" />
          ) : (
            matches.map((env, index) => (
              <ColumnItem
                key={env}
                title={env}
                selected={env === selected}
                index={index}
                onSelect={() => onSelect(env)}
                onActivate={onActivate}
              />
            ))
          )}
        </div>
      )}
    </BrowserColumn>
  )
}
