/**
 * Connection-scoped upload pending helpers for `useMediaPicker` and pending-key
 * set transitions shared with form submission guards.
 */
export class MediaUploadPending {
  static connectionKey(url: string | undefined, apiKey: string | undefined): string | null {
    return url && apiKey ? `${url}\0${apiKey}` : null
  }

  static isUploading(
    activeConnection: string | null,
    url: string | undefined,
    apiKey: string | undefined,
  ): boolean {
    const current = MediaUploadPending.connectionKey(url, apiKey)
    return current !== null && activeConnection === current
  }

  /** Pure set transition mirroring how forms track active media uploads by widget instance id. */
  static applyChange(currentKeys: ReadonlySet<string>, instanceId: string, pending: boolean): Set<string> {
    const next = new Set(currentKeys)
    if (pending) next.add(instanceId)
    else next.delete(instanceId)
    return next
  }
}
