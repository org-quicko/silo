import { createContext } from 'react'

// What ArrayFieldTemplate shares with its items. RJSF hands an item's data to
// the item's SchemaField only, never to ArrayFieldItemTemplate — which is
// exactly where a collapsed item's title has to come from — and there is no
// path at all for an array-level "collapse everything" action to reach the
// items, or for their open state to reach the array's header.
export interface ArrayItemsContextValue {
  /** The live array, so an item can read its own slice by index. */
  data: any[] | null
  /** Latest expand/collapse-all instruction; `nonce` re-fires a repeat click. */
  command: { open: boolean; nonce: number } | null
  /** An item reporting its open state, or `null` as it unmounts. */
  report: ((key: string, open: boolean | null) => void) | null
}

export const ArrayItemsContext = createContext<ArrayItemsContextValue | null>(null)
