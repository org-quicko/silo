import { describe, expect, test } from 'bun:test'
import { Store } from '../../store/store'
import type { ToastAction } from '../../utils/toast-manager'
import { TrashUndo } from './trash-undo'

interface RecordedToast {
  message: string
  action?: ToastAction
}

describe('TrashUndo session epoch gating', () => {
  test('offers permanent-delete message without action when trashId is null', () => {
    const toasts: RecordedToast[] = []
    TrashUndo.offer(
      null,
      'entry',
      'https://silo.local',
      'key-1',
      () => {},
      { showToast: (message, options) => toasts.push({ message, action: options?.action }) },
    )

    expect(toasts).toEqual([{ message: 'Deleted entry.', action: undefined }])
  })

  test('restores and invokes onRestored when sessionEpoch is unchanged', async () => {
    const sessionStore = new Store()
    const toasts: RecordedToast[] = []
    const restoredCalls: string[] = []
    let onRestoredCalls = 0

    TrashUndo.offer(
      'trash-1',
      'post',
      'https://silo.local',
      'key-1',
      () => {
        onRestoredCalls += 1
      },
      {
        sessionEpoch: () => sessionStore.sessionEpoch(),
        restore: async (url, key, id) => {
          restoredCalls.push(`${url}:${key}:${id}`)
        },
        showToast: (message, options) => toasts.push({ message, action: options?.action }),
      },
    )

    expect(toasts[0]?.action?.label).toBe('Undo')
    toasts[0]?.action?.onClick()
    await Promise.resolve()

    expect(restoredCalls).toEqual(['https://silo.local:key-1:trash-1'])
    expect(onRestoredCalls).toBe(1)
    expect(toasts[1]?.message).toBe('Restored post.')
  })

  test('skips restore and onRestored if store.clear() advances sessionEpoch before Undo is clicked', () => {
    const sessionStore = new Store()
    const toasts: RecordedToast[] = []
    let restoreCalls = 0
    let onRestoredCalls = 0

    TrashUndo.offer(
      'trash-2',
      'post',
      'https://silo.local',
      'key-1',
      () => {
        onRestoredCalls += 1
      },
      {
        sessionEpoch: () => sessionStore.sessionEpoch(),
        restore: async () => {
          restoreCalls += 1
        },
        showToast: (message, options) => toasts.push({ message, action: options?.action }),
      },
    )

    sessionStore.clear()
    toasts[0]?.action?.onClick()

    expect(restoreCalls).toBe(0)
    expect(onRestoredCalls).toBe(0)
    expect(toasts[1]?.message).toBe('Session changed — undo skipped.')
  })

  test('skips onRestored silently if store.clear() runs while trash.restore is in flight', async () => {
    const sessionStore = new Store()
    const toasts: RecordedToast[] = []
    let finishRestore!: () => void
    let onRestoredCalls = 0

    TrashUndo.offer(
      'trash-3',
      'post',
      'https://silo.local',
      'key-1',
      () => {
        onRestoredCalls += 1
      },
      {
        sessionEpoch: () => sessionStore.sessionEpoch(),
        restore: () =>
          new Promise<void>((resolve) => {
            finishRestore = resolve
          }),
        showToast: (message, options) => toasts.push({ message, action: options?.action }),
      },
    )

    toasts[0]?.action?.onClick()
    sessionStore.clear()
    finishRestore()
    await Promise.resolve()

    expect(onRestoredCalls).toBe(0)
    expect(toasts).toHaveLength(1)
  })

  test('suppresses stale restore error notice after sessionEpoch changes mid-flight', async () => {
    const sessionStore = new Store()
    const toasts: RecordedToast[] = []
    let rejectRestore!: (reason?: unknown) => void

    TrashUndo.offer(
      'trash-4',
      'post',
      'https://silo.local',
      'key-1',
      () => {},
      {
        sessionEpoch: () => sessionStore.sessionEpoch(),
        restore: () =>
          new Promise<void>((_resolve, reject) => {
            rejectRestore = reject
          }),
        showToast: (message, options) => toasts.push({ message, action: options?.action }),
      },
    )

    toasts[0]?.action?.onClick()
    sessionStore.clear()
    rejectRestore(new Error('401 Unauthorized'))
    await Promise.resolve()

    expect(toasts).toHaveLength(1)
  })
})
