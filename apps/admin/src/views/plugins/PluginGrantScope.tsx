import { useEffect, useState } from 'react'
import { api } from '../../api/silo-api'
import type { PluginGrantScope as GrantScope } from './plugin-grant-plan'
import styles from './PluginDetail.module.css'

/**
 * Narrow the wildcards a manifest asked for down to one project and
 * environment.
 *
 * Only the segments the plugin left as `*` move — see `PluginGrantPlan.narrow`.
 * "Everywhere" is the default because it is what the package requested, and a
 * form that silently narrowed would grant something other than what the review
 * above it described.
 */
export function PluginGrantScope({
  url,
  apiKey,
  projects,
  value,
  disabled,
  onChange,
}: {
  url: string
  apiKey: string
  projects: string[]
  value: GrantScope
  disabled: boolean
  onChange: (next: GrantScope) => void
}) {
  const [environments, setEnvironments] = useState<string[]>([])

  useEffect(() => {
    if (!value.project) {
      setEnvironments([])
      return
    }
    let live = true
    api.projects
      .listEnvironments(url, apiKey, value.project)
      .then((list) => live && setEnvironments(list))
      .catch(() => live && setEnvironments([]))
    return () => {
      live = false
    }
  }, [url, apiKey, value.project])

  return (
    <div className={styles.scopeRow}>
      <label className={styles.scopeField}>
        <span>Project</span>
        <select
          className="input"
          value={value.project}
          disabled={disabled}
          onChange={(event) => onChange({ project: event.target.value, env: '' })}
        >
          <option value="">Every project the plugin asked for</option>
          {projects.map((project) => (
            <option key={project} value={project}>{project}</option>
          ))}
        </select>
      </label>

      <label className={styles.scopeField}>
        <span>Environment</span>
        <select
          className="input"
          value={value.env}
          disabled={disabled || !value.project}
          onChange={(event) => onChange({ ...value, env: event.target.value })}
        >
          <option value="">Every environment</option>
          {environments.map((env) => (
            <option key={env} value={env}>{env}</option>
          ))}
        </select>
      </label>
    </div>
  )
}
