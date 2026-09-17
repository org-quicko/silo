import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Checkbox } from '../../components/controls/Checkbox'
import { TransferInclude } from './transfer-include'
import type { TransferTree } from './transfer-tree'
import styles from './TransferScopePicker.module.css'

/**
 * Which projects, environments and collections a transfer covers.
 *
 * Three levels deep because that is how far the archive tree nests and how far
 * the server's `include` rules go. A box is checked when it is chosen or sits
 * inside something chosen, and indeterminate when only part of it is, so
 * unchecking one environment of a chosen project leaves the rest in.
 */
export function TransferScopePicker({
  tree,
  rules,
  onChange,
  disabled,
}: {
  tree: TransferTree | null
  rules: string[]
  onChange: (next: string[]) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState<string[]>([])

  if (!tree) return <div className={styles.empty}>Reading the instance…</div>
  if (tree.projects.length === 0) return <div className={styles.empty}>Nothing to transfer yet.</div>

  const toggle = (rule: string, checked: boolean) =>
    onChange(TransferInclude.toggle(rules, rule, checked, tree))

  const expanded = (rule: string) => open.includes(rule)
  const flip = (rule: string) =>
    setOpen((current) =>
      current.includes(rule) ? current.filter((each) => each !== rule) : [...current, rule],
    )

  const box = (rule: string) => (
    <Checkbox
      checked={TransferInclude.covered(rules, rule)}
      indeterminate={TransferInclude.partial(rules, rule)}
      onChange={(checked) => toggle(rule, checked)}
      disabled={disabled}
      aria-label={rule}
    />
  )

  const twist = (rule: string, hasChildren: boolean) =>
    hasChildren ? (
      <button
        type="button"
        className={styles.twist}
        onClick={() => flip(rule)}
        aria-label={`${expanded(rule) ? 'Collapse' : 'Expand'} ${rule}`}
        aria-expanded={expanded(rule)}
      >
        {expanded(rule) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
    ) : (
      <span className={styles.spacer} />
    )

  return (
    <div className={styles.tree} role="group" aria-label="What to transfer">
      {tree.projects.map((project) => (
        <div key={project.name}>
          <div className={styles.node}>
            {twist(project.name, project.envs.length > 0)}
            {box(project.name)}
            <label className={styles.label}>
              <b>{project.name}</b>
              <span className={styles.count}>
                {project.envs.length} {project.envs.length === 1 ? 'environment' : 'environments'}
              </span>
            </label>
          </div>

          {expanded(project.name) &&
            project.envs.map((env) => {
              const envRule = `${project.name}/${env.name}`
              return (
                <div key={envRule}>
                  <div className={`${styles.node} ${styles.env}`}>
                    {twist(envRule, env.collections.length > 0)}
                    {box(envRule)}
                    <label className={styles.label}>
                      <b>{env.name}</b>
                      <span className={styles.count}>
                        {env.collections.length}{' '}
                        {env.collections.length === 1 ? 'collection' : 'collections'}
                      </span>
                    </label>
                  </div>

                  {expanded(envRule) &&
                    env.collections.map((collection) => {
                      const rule = `${envRule}/${collection.name}`
                      return (
                        <div key={rule} className={`${styles.node} ${styles.collection}`}>
                          {box(rule)}
                          <label className={styles.label}>
                            {collection.name}
                            <span className={styles.count}>
                              {collection.entries}{' '}
                              {collection.entries === 1 ? 'entry' : 'entries'}
                            </span>
                          </label>
                        </div>
                      )
                    })}
                </div>
              )
            })}
        </div>
      ))}
    </div>
  )
}
