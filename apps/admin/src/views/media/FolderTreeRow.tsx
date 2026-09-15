import { ChevronDown, ChevronRight, Folder, FolderOpen } from 'lucide-react'
import type { FolderNode } from './media-folder-tree'
import styles from './MediaLibrary.module.css'

interface Props {
  node: FolderNode
  /** How deep this row sits, for its indent. The root renders at 0. */
  depth: number
  selected: string | null
  expanded: Set<string>
  /** Why this folder cannot take the items, or `undefined` when it can — one
   *  prop rather than a disabled flag and a title that could disagree. */
  blockedReason: (path: string) => string | undefined
  onSelect: (path: string) => void
  onToggle: (path: string) => void
}

/** One folder in the move picker's tree, and its open children beneath it.
 *  The disclosure arrow and the name are separate buttons, not one nested in
 *  the other — expanding a folder and choosing it are different answers. */
export function FolderTreeRow({ node, depth, selected, expanded, blockedReason, onSelect, onToggle }: Props) {
  const isOpen = expanded.has(node.path)
  const isSelected = selected === node.path
  const reason = blockedReason(node.path)

  return (
    <>
      <div className={styles.treeRow} style={{ ['--depth' as any]: depth }}>
        {node.children.length > 0 ? (
          <button
            type="button"
            className={styles.treeToggle}
            aria-label={isOpen ? `Collapse ${node.name}` : `Expand ${node.name}`}
            aria-expanded={isOpen}
            onClick={() => onToggle(node.path)}
          >
            {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
        ) : (
          <span className={styles.treeToggle} />
        )}
        <button
          type="button"
          className={`${styles.treeName} ${isSelected ? styles.treeNameSelected : ''}`}
          disabled={reason !== undefined}
          title={reason}
          onClick={() => onSelect(node.path)}
        >
          {isOpen ? <FolderOpen size={14} /> : <Folder size={14} />}
          <span className={styles.treeLabel}>{node.name}</span>
        </button>
      </div>

      {isOpen &&
        node.children.map((child) => (
          <FolderTreeRow
            key={child.path}
            node={child}
            depth={depth + 1}
            selected={selected}
            expanded={expanded}
            blockedReason={blockedReason}
            onSelect={onSelect}
            onToggle={onToggle}
          />
        ))}
    </>
  )
}
