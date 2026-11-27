/**
 * Coordinates mutually exclusive save and delete lifecycle locks for
 * `SchemaEditorView` so:
 * 1) `save()` and `removeCollection()` never run concurrently,
 * 2) `saving` remains locked across both the API save and any asynchronous
 *    post-save refresh/navigation callback until unmount, and
 * 3) stale completions after unmount are ignored cleanly.
 */
export class SchemaSaveGuard {
  private saving = false
  private deleting = false
  private mounted = true
  private token = 0

  isSaving(): boolean {
    return this.saving
  }

  isDeleting(): boolean {
    return this.deleting
  }

  isCurrent(runToken: number): boolean {
    return this.mounted && this.token === runToken
  }

  mount(): void {
    this.mounted = true
  }

  unmount(): void {
    this.mounted = false
    this.token += 1
  }

  async runSave(options: {
    persist: () => Promise<void>
    onSuccess: (isCurrent: () => boolean) => void | Promise<void>
    onStateChange: (saving: boolean) => void
    onError: (caught: unknown) => void
  }): Promise<boolean> {
    if (this.saving || this.deleting) return false
    const runToken = ++this.token
    this.saving = true
    options.onStateChange(true)
    try {
      await options.persist()
      if (!this.isCurrent(runToken)) return false
      await options.onSuccess(() => this.isCurrent(runToken))
      return true
    } catch (caught) {
      if (this.isCurrent(runToken)) {
        this.saving = false
        options.onStateChange(false)
        options.onError(caught)
      }
      return false
    } finally {
      if (this.isCurrent(runToken) && this.saving) {
        // Only unlock if still mounted after `onSuccess` resolved without unmounting.
        this.saving = false
        options.onStateChange(false)
      }
    }
  }

  /** Runs an external commit operation (such as collection rename) under the
   *  same mutual-exclusion lock as `runSave`, holding `saving` from before the
   *  API request starts through post-mutation refresh/navigation until unmount. */
  async runCommit(options: {
    run: (isCurrent: () => boolean) => Promise<void>
    onStateChange: (saving: boolean) => void
  }): Promise<boolean> {
    if (this.saving || this.deleting) return false
    const runToken = ++this.token
    this.saving = true
    options.onStateChange(true)
    try {
      await options.run(() => this.isCurrent(runToken))
      return this.isCurrent(runToken)
    } finally {
      if (this.isCurrent(runToken) && this.saving) {
        this.saving = false
        options.onStateChange(false)
      }
    }
  }

  async runDelete(options: {
    remove: () => Promise<void>
    onSuccess: (isCurrent: () => boolean) => void | Promise<void>
    onStateChange: (deleting: boolean) => void
    onError: (caught: unknown) => void
  }): Promise<boolean> {
    if (this.deleting || this.saving) return false
    const runToken = ++this.token
    this.deleting = true
    options.onStateChange(true)
    try {
      await options.remove()
      if (!this.isCurrent(runToken)) return false
      await options.onSuccess(() => this.isCurrent(runToken))
      return true
    } catch (caught) {
      if (this.isCurrent(runToken)) {
        this.deleting = false
        options.onStateChange(false)
        options.onError(caught)
      }
      return false
    }
  }
}
