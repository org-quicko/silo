import { useState } from 'react'
import type { ScopeRef } from '../../api/types/scope-ref'
import { ColumnWidths } from './column-widths'

/** What a table needs to draw its columns and to let a reader move the boundaries. */
export interface ColumnWidthState {
  widths: Record<string, number>
  setWidth: (name: string, width: number) => void
  /** Hands one column back to the table's own proportional sizing. */
  resetWidth: (name: string) => void
}

/** Column widths for one collection's table, remembered per browser. */
export function useColumnWidths(serverId: string, scope: ScopeRef, collection: string): ColumnWidthState {
  const key = ColumnWidths.key(serverId, scope.project, scope.env, collection)
  const [state, setState] = useState(() => ({ key, widths: ColumnWidths.read(key) }))
  // Another collection is another table. Adjusting during render is React's own
  // answer to state derived from props, and it keeps one render from drawing
  // this collection's columns at the previous one's widths.
  if (state.key !== key) setState({ key, widths: ColumnWidths.read(key) })

  const commit = (widths: Record<string, number>) => {
    ColumnWidths.write(key, widths)
    setState({ key, widths })
  }

  return {
    widths: state.widths,
    setWidth: (name, width) => commit({ ...state.widths, [name]: width }),
    resetWidth: (name) => {
      if (!(name in state.widths)) return
      const { [name]: _removed, ...rest } = state.widths
      commit(rest)
    },
  }
}
