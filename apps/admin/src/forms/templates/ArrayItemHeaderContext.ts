import { createContext } from 'react'

// The field id whose title an array item's header already renders.
// ObjectFieldTemplate reads it so an item's own object doesn't repeat that
// label immediately under the header that just showed it; objects nested
// deeper inside the item still get their group label.
export const ArrayItemHeaderContext = createContext<string | null>(null)
