import { useEffect } from 'react'
import { DocumentTitle } from './document-title'
import type { Route } from './route'

/** Keeps the browser tab named after the route. One caller, `App`, because the
 *  title belongs to the document and not to whichever view happens to be up. */
export function useDocumentTitle(route: Route | null, serverName: string | null): void {
  const title = DocumentTitle.of(route, serverName)
  useEffect(() => {
    document.title = title
  }, [title])
}
