import { VariableTemplate } from '@silo/shared/variable-template'

/**
 * The two directions between a stored string and the editor's DOM, and the
 * caret arithmetic that goes with them (D57).
 *
 * Split out from the component for the reason `variable-hints.ts` is: these are
 * the rules that decide whether an edit round-trips, and getting one wrong
 * silently changes content. They are testable against a document fragment
 * without mounting a form.
 *
 * The string is the source of truth and the DOM is a rendering of it. Every
 * chip is one `contenteditable="false"` element carrying its name in
 * `data-var`, which is what makes it **atomic**: the browser's own caret
 * movement, selection and Backspace treat it as a single character, so none of
 * that had to be reimplemented.
 */
export class VariableDom {
  /** Marks the element that stands in for one `{{NAME}}`. */
  static readonly Attribute = 'data-var'

  /**
   * The string a rendered field currently holds.
   *
   * A chip contributes `{{NAME}}` rather than whatever it happens to display,
   * which is the whole point of rendering the value inside it: what the reader
   * sees is the value, what the entry stores is the reference.
   *
   * `<br>` and block boundaries become newlines, because a browser is free to
   * end a line either way and a field that stored a different string depending
   * on which one Chrome chose would be a field that changed content on save.
   */
  static read(root: HTMLElement): string {
    let text = ''

    const walk = (node: Node, top: boolean): void => {
      const children = Array.from(node.childNodes)
      for (const child of children) {
        // The "bogus br": browsers append a trailing `<br>` to a contenteditable
        // so the last line stays reachable, and it is layout rather than
        // content. Counting it would append a newline to the value on every
        // edit, growing the entry a line at a time.
        if (
          top &&
          child === children[children.length - 1] &&
          child.nodeType === Node.ELEMENT_NODE &&
          (child as HTMLElement).tagName === 'BR'
        ) {
          continue
        }
        if (child.nodeType === Node.TEXT_NODE) {
          text += child.nodeValue ?? ''
          continue
        }
        if (child.nodeType !== Node.ELEMENT_NODE) continue

        const element = child as HTMLElement
        const name = element.getAttribute(VariableDom.Attribute)
        if (name !== null) {
          text += VariableTemplate.spell(name)
          continue
        }
        if (element.tagName === 'BR') {
          text += '\n'
          continue
        }
        // A div or p the browser created for a new line: its content starts a
        // line of its own, except the first, which continues the one above.
        const block = getComputedStyle(element).display !== 'inline'
        if (block && !top && text !== '') text += '\n'
        walk(element, false)
      }
    }

    walk(root, true)
    return text
  }

  /**
   * Where the caret is, as an index into {@link read}'s string.
   *
   * Counted the same way `read` builds the string, so the two cannot disagree:
   * a chip is one unit of `{{NAME}}`.length, and a caret sitting after a chip
   * is the offset past its closing brace.
   */
  static caretOffset(root: HTMLElement, container: Node, offset: number): number {
    let count = 0
    let found = false

    const walk = (node: Node, top: boolean): void => {
      if (found) return
      for (const child of Array.from(node.childNodes)) {
        if (found) return

        if (node === container && Array.from(node.childNodes).indexOf(child) === offset) {
          found = true
          return
        }

        if (child.nodeType === Node.TEXT_NODE) {
          if (child === container) {
            count += offset
            found = true
            return
          }
          count += (child.nodeValue ?? '').length
          continue
        }
        if (child.nodeType !== Node.ELEMENT_NODE) continue

        const element = child as HTMLElement
        const name = element.getAttribute(VariableDom.Attribute)
        if (name !== null) {
          count += VariableTemplate.spell(name).length
          continue
        }
        if (element.tagName === 'BR') {
          count += 1
          continue
        }
        const block = getComputedStyle(element).display !== 'inline'
        if (block && !top && count !== 0) count += 1
        walk(element, false)
      }
      // The caret can also sit at the very end of a container, past its last
      // child, which the index check above never reaches.
      if (node === container && offset >= node.childNodes.length) found = true
    }

    walk(root, true)
    return count
  }

  /**
   * Places the caret at `target`, counted in the same units.
   *
   * A target that lands *inside* a chip is moved to the end of it: a caret
   * cannot be half-way through an atomic node, and rounding forward is what
   * makes retyping the tail of a reference feel like editing text rather than
   * jumping backwards.
   */
  static setCaret(root: HTMLElement, target: number): void {
    const selection = window.getSelection()
    if (!selection) return

    let count = 0
    let placed = false

    const walk = (node: Node, top: boolean): void => {
      if (placed) return
      for (const child of Array.from(node.childNodes)) {
        if (placed) return

        if (child.nodeType === Node.TEXT_NODE) {
          const length = (child.nodeValue ?? '').length
          if (count + length >= target) {
            const range = document.createRange()
            range.setStart(child, Math.max(0, target - count))
            range.collapse(true)
            selection.removeAllRanges()
            selection.addRange(range)
            placed = true
            return
          }
          count += length
          continue
        }
        if (child.nodeType !== Node.ELEMENT_NODE) continue

        const element = child as HTMLElement
        const name = element.getAttribute(VariableDom.Attribute)
        if (name !== null) {
          const length = VariableTemplate.spell(name).length
          if (count + length >= target) {
            const range = document.createRange()
            range.setStartAfter(element)
            range.collapse(true)
            selection.removeAllRanges()
            selection.addRange(range)
            placed = true
            return
          }
          count += length
          continue
        }
        if (element.tagName === 'BR') {
          if (count + 1 >= target) {
            const range = document.createRange()
            range.setStartAfter(element)
            range.collapse(true)
            selection.removeAllRanges()
            selection.addRange(range)
            placed = true
            return
          }
          count += 1
          continue
        }
        const block = getComputedStyle(element).display !== 'inline'
        if (block && !top && count !== 0) count += 1
        walk(element, false)
      }
    }

    walk(root, true)

    if (!placed) {
      // Past the end, which is where a caret lands after typing the last
      // character of a completed reference.
      const range = document.createRange()
      range.selectNodeContents(root)
      range.collapse(false)
      selection.removeAllRanges()
      selection.addRange(range)
    }
  }
}
