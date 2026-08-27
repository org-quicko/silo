import { Globe, Layers, Boxes, Server } from 'lucide-react'
import type { ReactNode } from 'react'
import type { KeyReach } from './key-reach'
import styles from './NewKey.module.css'

interface ReachOption {
  value: KeyReach
  label: string
  icon: ReactNode
  /** Why this reach is unavailable, or '' when it is offered. */
  blocked: string
}

/**
 * The project and env segments of the key's collection claims.
 *
 * Both selectors stay mounted for every reach and grey out the segment that
 * option wildcards, so switching between reaches reads as widening or
 * narrowing one sentence rather than as four unrelated forms.
 */
export function NewKeyReach({
  reach,
  project,
  env,
  projects,
  environments,
  loadingEnvironments,
  blocked,
  onChange,
}: {
  reach: KeyReach
  project: string
  env: string
  projects: string[]
  environments: string[]
  loadingEnvironments: boolean
  /** Reaches the current key cannot delegate, mapped to the reason why. */
  blocked: Partial<Record<KeyReach, string>>
  onChange: (patch: { reach?: KeyReach; project?: string; env?: string }) => void
}) {
  const options: ReachOption[] = [
    { value: 'env', label: 'One environment', icon: <Layers size={14} />, blocked: blocked.env ?? '' },
    { value: 'project', label: 'A whole project', icon: <Boxes size={14} />, blocked: blocked.project ?? '' },
    { value: 'env-all-projects', label: 'One environment, every project', icon: <Globe size={14} />, blocked: blocked['env-all-projects'] ?? '' },
    { value: 'instance', label: 'The entire instance', icon: <Server size={14} />, blocked: blocked.instance ?? '' },
  ]

  const projectNamed = reach === 'env' || reach === 'project'
  const envNamed = reach === 'env' || reach === 'env-all-projects'

  return (
    <div className={styles.reach}>
      <div className={styles.reachOptions}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`${styles.reachOption} ${reach === option.value ? styles.reachOptionActive : ''}`}
            disabled={!!option.blocked}
            title={option.blocked || undefined}
            onClick={() => onChange({ reach: option.value })}
          >
            {option.icon}
            <span>{option.label}</span>
          </button>
        ))}
      </div>

      <div className={styles.segments}>
        <div className={`${styles.segment} ${projectNamed ? '' : styles.segmentWild}`}>
          <span className={styles.segmentLabel}>Project</span>
          {projectNamed ? (
            <select className="input" value={project} onChange={(event) => onChange({ project: event.target.value })}>
              {projects.length === 0 && <option value={project}>{project || '—'}</option>}
              {projects.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          ) : (
            <span className={styles.segmentWildValue}>every project</span>
          )}
        </div>

        <span className={styles.segmentSlash}>/</span>

        <div className={`${styles.segment} ${envNamed ? '' : styles.segmentWild}`}>
          <span className={styles.segmentLabel}>Environment</span>
          {reach === 'env' ? (
            <select
              className="input"
              value={env}
              disabled={loadingEnvironments}
              onChange={(event) => onChange({ env: event.target.value })}
            >
              {environments.length === 0 && <option value={env}>{env || '—'}</option>}
              {environments.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          ) : reach === 'env-all-projects' ? (
            // Free text rather than a picker, because this reach names an
            // environment *name* that may exist in projects the current key
            // cannot list — the ids of one project's environments are a
            // suggestion here, not the set of valid answers.
            <>
              <input
                className="input"
                list="silo-known-envs"
                value={env}
                spellCheck={false}
                placeholder="prod"
                onChange={(event) => onChange({ env: event.target.value.trim() })}
              />
              <datalist id="silo-known-envs">
                {environments.map((name) => <option key={name} value={name} />)}
              </datalist>
            </>
          ) : (
            <span className={styles.segmentWildValue}>every environment</span>
          )}
        </div>
      </div>
    </div>
  )
}
