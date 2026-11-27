/**
 * Tracks mounted `Modal` instances in LIFO order so `Escape` closes only the
 * topmost dialog when multiple modals are stacked.
 */
export class ModalStack {
  private static readonly stack: string[] = []

  static push(modalId: string): void {
    ModalStack.stack.push(modalId)
  }

  static remove(modalId: string): void {
    const index = ModalStack.stack.lastIndexOf(modalId)
    if (index !== -1) ModalStack.stack.splice(index, 1)
  }

  static isTop(modalId: string): boolean {
    return ModalStack.stack.length > 0 && ModalStack.stack[ModalStack.stack.length - 1] === modalId
  }

  static clear(): void {
    ModalStack.stack.length = 0
  }
}
