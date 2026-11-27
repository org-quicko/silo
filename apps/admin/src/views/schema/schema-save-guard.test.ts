import { describe, expect, test } from 'bun:test'
import { SchemaSaveGuard } from './schema-save-guard'

describe('SchemaSaveGuard', () => {
  test('stays locked across slow post-save refresh until navigation unmounts it', async () => {
    const guard = new SchemaSaveGuard()
    const states: boolean[] = []
    let releaseRefresh!: () => void
    let navigated = false

    const pending = guard.runSave({
      persist: async () => {},
      onSuccess: () =>
        new Promise<void>((resolve) => {
          releaseRefresh = () => {
            navigated = true
            guard.unmount()
            resolve()
          }
        }),
      onStateChange: (saving) => states.push(saving),
      onError: () => {
        throw new Error('unexpected error')
      },
    })

    // Flush persist() microtask; slow onSuccess is still pending.
    await Promise.resolve()
    expect(guard.isSaving()).toBe(true)
    expect(states).toEqual([true])
    expect(navigated).toBe(false)

    // Concurrent delete or second save is blocked while locked.
    const secondSave = await guard.runSave({
      persist: async () => {
        throw new Error('must not run')
      },
      onSuccess: () => {},
      onStateChange: () => {},
      onError: () => {},
    })
    const concurrentDelete = await guard.runDelete({
      remove: async () => {
        throw new Error('must not run')
      },
      onSuccess: () => {},
      onStateChange: () => {},
      onError: () => {},
    })
    expect(secondSave).toBe(false)
    expect(concurrentDelete).toBe(false)

    releaseRefresh()
    await pending
    expect(navigated).toBe(true)
    // Unmount prevented post-navigation unlock.
    expect(states).toEqual([true])
  })

  test('unlocks and reports error when persist fails, and blocks save during delete', async () => {
    const guard = new SchemaSaveGuard()
    let message = ''
    const ok = await guard.runSave({
      persist: async () => {
        throw new Error('network error')
      },
      onSuccess: () => {},
      onStateChange: () => {},
      onError: (caught) => {
        message = (caught as Error).message
      },
    })
    expect(ok).toBe(false)
    expect(message).toBe('network error')
    expect(guard.isSaving()).toBe(false)

    let resolveDelete!: () => void
    const delPromise = guard.runDelete({
      remove: () =>
        new Promise<void>((resolve) => {
          resolveDelete = resolve
        }),
      onSuccess: () => guard.unmount(),
      onStateChange: () => {},
      onError: () => {},
    })
    expect(guard.isDeleting()).toBe(true)
    const blockedSave = await guard.runSave({
      persist: async () => {
        throw new Error('must not run during delete')
      },
      onSuccess: () => {},
      onStateChange: () => {},
      onError: () => {},
    })
    expect(blockedSave).toBe(false)
    resolveDelete()
    await delPromise
  })

  test('isCurrent invalidates delayed async navigation once unmounted before completion', async () => {
    const guard = new SchemaSaveGuard()
    let capturedIsCurrent!: () => boolean
    let releaseNav!: () => void

    const pending = guard.runSave({
      persist: async () => {},
      onSuccess: (isCurrent) => {
        capturedIsCurrent = isCurrent
        return new Promise<void>((resolve) => {
          releaseNav = resolve
        })
      },
      onStateChange: () => {},
      onError: () => {},
    })

    await Promise.resolve()
    expect(capturedIsCurrent()).toBe(true)

    // User leaves this editor visit while refresh is still in flight.
    guard.unmount()
    expect(capturedIsCurrent()).toBe(false)

    releaseNav()
    await pending
  })

  test('runCommit locks immediately when rename starts and stays locked through post-rename navigation until unmount', async () => {
    const guard = new SchemaSaveGuard()
    const states: boolean[] = []
    let releaseRename!: () => void
    let releaseNavigation!: () => void
    let disarmedAfterRename = false

    const renameRun = guard.runCommit({
      onStateChange: (saving) => states.push(saving),
      run: async (isCurrent) => {
        await new Promise<void>((resolve) => {
          releaseRename = resolve
        })
        if (!isCurrent()) return
        disarmedAfterRename = true
        await new Promise<void>((resolve) => {
          releaseNavigation = () => {
            guard.unmount()
            resolve()
          }
        })
      },
    })

    // Lock must be active synchronously before the rename HTTP request settles.
    expect(guard.isSaving()).toBe(true)
    expect(states).toEqual([true])
    expect(disarmedAfterRename).toBe(false)

    const blockedSave = await guard.runSave({
      persist: async () => {
        throw new Error('save must be blocked while rename is in flight')
      },
      onSuccess: () => {},
      onStateChange: () => {},
      onError: () => {},
    })
    expect(blockedSave).toBe(false)

    releaseRename()
    await Promise.resolve()
    expect(disarmedAfterRename).toBe(true)
    expect(guard.isSaving()).toBe(true)

    releaseNavigation()
    const completed = await renameRun
    expect(completed).toBe(false)
    expect(states).toEqual([true])
  })

  test('runCommit unlocks if the rename request fails before unmount', async () => {
    const guard = new SchemaSaveGuard()
    const states: boolean[] = []

    await expect(
      guard.runCommit({
        onStateChange: (saving) => states.push(saving),
        run: async () => {
          throw new Error('409 Conflict')
        },
      }),
    ).rejects.toThrow('409 Conflict')

    expect(guard.isSaving()).toBe(false)
    expect(states).toEqual([true, false])
  })
})
