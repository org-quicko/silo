import { useState } from 'react'
import { Boxes, Folder, Layers } from 'lucide-react'
import { BrowserColumns } from '../../components/browser/BrowserColumns'
import { TransferScopeColumn, type TransferScopeItem } from './TransferScopeColumn'
import { TransferInclude } from './transfer-include'
import type { TransferTree } from './transfer-tree'
import styles from './TransferScopePicker.module.css'

/**
 * What a transfer covers, browsed the way the server manager browses a scope:
 * projects, then environments, then collections, one pane per level.
 *
 * Three levels because that is exactly how far the server's `include` rules go,
 * and the same walk the sidebar already makes, so choosing what to move reads
 * like finding it. A box is checked when its rule is chosen or sits inside
 * something chosen, and indeterminate when only part of it is.
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
  const [project, setProject] = useState<string | null>(null)
  const [env, setEnv] = useState<string | null>(null)

  const openProject = tree?.projects.find((each) => each.name === project) ?? null
  const openEnv = openProject?.envs.find((each) => each.name === env) ?? null

  const check = (rule: string, next: boolean) => {
    if (tree) onChange(TransferInclude.toggle(rules, rule, next, tree))
  }
  const plural = (count: number, one: string, many: string) =>
    `${count} ${count === 1 ? one : many}`

  const projects: TransferScopeItem[] | null =
    tree?.projects.map((each) => ({
      name: each.name,
      subtitle: plural(each.envs.length, 'environment', 'environments'),
      rule: each.name,
    })) ?? null

  const envs: TransferScopeItem[] | null =
    openProject?.envs.map((each) => ({
      name: each.name,
      subtitle: plural(each.collections.length, 'collection', 'collections'),
      rule: `${openProject.name}/${each.name}`,
    })) ?? null

  const collections: TransferScopeItem[] | null =
    openProject && openEnv
      ? openEnv.collections.map((each) => ({
          name: each.name,
          subtitle: plural(each.entries, 'entry', 'entries'),
          rule: `${openProject.name}/${openEnv.name}/${each.name}`,
        }))
      : null

  const shared = {
    checked: (rule: string) => TransferInclude.covered(rules, rule),
    partial: (rule: string) => TransferInclude.partial(rules, rule),
    disabled,
    onCheck: check,
  }

  return (
    <div className={styles.browser}>
      <BrowserColumns>
        <TransferScopeColumn
          {...shared}
          icon={Folder}
          title="Projects"
          items={projects}
          selected={project}
          loading={!tree}
          waitingFor="Nothing to transfer yet"
          chevron
          onOpen={(item) => {
            setProject(item.name)
            setEnv(null)
          }}
        />
        <TransferScopeColumn
          {...shared}
          icon={Layers}
          title="Environments"
          items={envs}
          selected={env}
          waitingFor="Select a project"
          hint="Environments will appear here"
          chevron
          onOpen={(item) => setEnv(item.name)}
        />
        <TransferScopeColumn
          {...shared}
          icon={Boxes}
          title="Collections"
          items={collections}
          waitingFor={openProject ? 'Select an environment' : 'Select a project'}
          hint="Collections will appear here"
        />
      </BrowserColumns>
    </div>
  )
}
