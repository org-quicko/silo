/** Whether a key press belongs to the element that received it. */
export class Keyboard {
  /**
   * True for the elements that own every key typed into them: a shortcut must
   * not fire while someone is writing a filter value or a search.
   */
  static isTyping(target: EventTarget | null): boolean {
    const element = target as HTMLElement | null
    const tag = element?.tagName
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || element?.isContentEditable === true
  }
}
