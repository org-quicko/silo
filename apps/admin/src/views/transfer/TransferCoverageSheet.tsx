import { Boxes, Folder, Layers } from 'lucide-react'
import { Sheet } from '../../components/modal/Sheet'
import styles from './TransferCoverageSheet.module.css'

/**
 * Everything a narrowed transfer covers, read in full.
 *
 * A fact row ellipsises, and forty-six rules on one line says nothing at all.
 * They are grouped by project here because that is the grouping a reader can
 * check against what they chose: they picked a project, or they picked inside
 * one.
 */
export function TransferCoverageSheet({
  rules,
  onClose,
}: {
  rules: string[]
  onClose: () => void
}) {
  const byProject = new Map<string, string[]>()
  for (const rule of [...rules].sort()) {
    const project = rule.split('/')[0]!
    byProject.set(project, [...(byProject.get(project) ?? []), rule])
  }

  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

  return (
    <Sheet
      title="What this archive covers"
      subtitle={`${count(rules.length, 'rule', 'rules')} across ${count(byProject.size, 'project', 'projects')}.`}
      icon={<Folder size={16} />}
      onClose={onClose}
    >
      <div className={styles.groups}>
        {[...byProject].map(([project, owned]) => {
          // A project chosen outright is one rule that *is* the heading, so it
          // is said once rather than repeated as its own only child.
          const whole = owned.length === 1 && owned[0] === project
          return (
            <section key={project} className={styles.group}>
              <h3>
                <Folder size={13} /> {project}
                <small>{whole ? 'every environment' : count(owned.length, 'rule', 'rules')}</small>
              </h3>
              {!whole && (
                <ul>
                  {owned.map((rule) => (
                    <li key={rule}>
                      {rule.split('/').length === 2 ? <Layers size={12} /> : <Boxes size={12} />}
                      <code>{rule}</code>
                      {rule.split('/').length === 2 && <small>every collection</small>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )
        })}
      </div>
    </Sheet>
  )
}
