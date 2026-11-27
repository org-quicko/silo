import { afterEach, describe, expect, test } from 'bun:test'
import { ModalStack } from './modal-stack'

describe('ModalStack', () => {
  afterEach(() => {
    ModalStack.clear()
  })

  test('tracks stacked modals LIFO so only the topmost modal handles Escape', () => {
    ModalStack.push('delete-modal')
    expect(ModalStack.isTop('delete-modal')).toBe(true)

    ModalStack.push('shortcuts-modal')
    expect(ModalStack.isTop('delete-modal')).toBe(false)
    expect(ModalStack.isTop('shortcuts-modal')).toBe(true)

    ModalStack.remove('shortcuts-modal')
    expect(ModalStack.isTop('delete-modal')).toBe(true)

    ModalStack.remove('delete-modal')
    expect(ModalStack.isTop('delete-modal')).toBe(false)
  })
})
