import { useState } from 'react'
import { Search, type LucideIcon } from 'lucide-react'
import { BrowserColumn } from '../../components/browser/BrowserColumn'
import { ColumnItem } from '../../components/browser/ColumnItem'
import { ColumnPlaceholder } from '../../components/browser/ColumnPlaceholder'
import { ColumnSearch } from '../../components/browser/ColumnSearch'
import { Checkbox } from '../../components/controls/Checkbox'
import styles from './TransferScopePicker.module.css'

/** One row of a scope column: what it is called, and the rule it stands for. */
export interface TransferScopeItem {
  name: string
  subtitle: string
  /** The `project[/env[/collection]]` rule this row checks and unchecks. */
  rule: string
}

/** The column's own box: everything this level lists, checked or cleared at
 *  once. Its tri-state is read from the level above rather than counted here,
 *  so it agrees with the row that stands for the same thing. */
export interface TransferScopeSelectAll {
  checked: boolean
  partial: boolean
  onChange: (next: boolean) => void
}

/**
 * One pane of the scope picker.
 *
 * The three levels differ only in what they list and whether a row leads
 * anywhere, so they are one component rather than three near-copies. The local
 * search box is per-column, exactly as it is in the server manager.
 */
export function TransferScopeColumn({
  icon,
  title,
  items,
  selected,
  waitingFor,
  hint,
  loading,
  chevron,
  checked,
  partial,
  disabled,
  selectAll,
  onCheck,
  onOpen,
}: {
  icon: LucideIcon
  title: string
  /** Null while the column upstream of this one has chosen nothing. */
  items: TransferScopeItem[] | null
  selected?: string | null
  /** What to say while the column is inert: "Select a project". */
  waitingFor: string
  hint?: string
  loading?: boolean
  chevron?: boolean
  checked: (rule: string) => boolean
  partial: (rule: string) => boolean
  disabled?: boolean
  /** Absent while the column lists nothing to select. */
  selectAll?: TransferScopeSelectAll
  onCheck: (rule: string, next: boolean) => void
  /** Absent on the last column, whose rows lead nowhere. */
  onOpen?: (item: TransferScopeItem) => void
}) {
  const [query, setQuery] = useState('')
  const search = query.trim().toLowerCase()
  const matches = (items ?? []).filter((item) => item.name.toLowerCase().includes(search))

  return (
    <BrowserColumn
      icon={icon}
      title={title}
      count={items ? items.length : undefined}
      resultCount={search && items ? matches.length : undefined}
      search={
        items && items.length > 0 ? (
          <ColumnSearch
            label={`Search ${title.toLowerCase()}`}
            value={query}
            onChange={setQuery}
            disabled={disabled}
          />
        ) : undefined
      }
      // The box covers the whole level, not the rows a search left on screen:
      // a filter hides rows, and a control that quietly dropped them would
      // clear a selection the reader cannot see.
      headerAction={
        selectAll && items && items.length > 0 ? (
          <label className={styles.selectAll} title={`Select all ${title.toLowerCase()}`}>
            <Checkbox
              checked={selectAll.checked}
              indeterminate={selectAll.partial}
              disabled={disabled}
              aria-label={`Select all ${title.toLowerCase()}`}
              onChange={selectAll.onChange}
            />
            <span>All</span>
          </label>
        ) : undefined
      }
      active={Boolean(items)}
    >
      {loading ? (
        <ColumnPlaceholder loading message={`Loading ${title.toLowerCase()}…`} />
      ) : !items ? (
        <ColumnPlaceholder icon={icon} message={waitingFor} hint={hint} />
      ) : items.length === 0 ? (
        <ColumnPlaceholder icon={icon} message={`No ${title.toLowerCase()}`} />
      ) : matches.length === 0 ? (
        <ColumnPlaceholder
          icon={Search}
          message={`No matching ${title.toLowerCase()}`}
          hint="Try another name or clear the search"
        />
      ) : (
        matches.map((item, index) => (
          <ColumnItem
            key={item.rule}
            title={item.name}
            subtitle={item.subtitle}
            selected={item.name === selected}
            index={index}
            chevron={chevron}
            lead={
              <Checkbox
                checked={checked(item.rule)}
                indeterminate={partial(item.rule)}
                disabled={disabled}
                aria-label={item.rule}
                onChange={(next) => onCheck(item.rule, next)}
              />
            }
            // A row that leads nowhere still has to be clickable, so on the
            // last column the row itself is the checkbox's larger target.
            onSelect={() =>
              onOpen ? onOpen(item) : onCheck(item.rule, !checked(item.rule))
            }
          />
        ))
      )}
    </BrowserColumn>
  )
}
