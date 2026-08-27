/** An `@`-mention the caret currently sits inside. */
export interface ActiveMention {
  /** Index in the text where the `@` sits. */
  start: number
  /** Text typed after the `@`, used to filter suggestions. */
  query: string
}

/**
 * The `@`-mention tokeniser for the smart search bar (handoff 1f).
 *
 * `@` only opens a token at the *start* of a word — position 0, or right
 * after whitespace — so an email address or a mid-sentence `@` typed into a
 * search can never summon the popup. There is always at most one active
 * mention by construction: `at` looks at whichever `@` governs the caret's
 * current word, so a second `@` typed elsewhere in the field simply becomes
 * the one that matters the moment the caret moves there.
 */
export class MentionToken {
  static at(text: string, caret: number): ActiveMention | null {
    for (let i = caret - 1; i >= 0; i--) {
      const c = text[i]
      if (c === '@') {
        const before = i > 0 ? text[i - 1] : undefined
        return before === undefined || /\s/.test(before) ? { start: i, query: text.slice(i + 1, caret) } : null
      }
      if (/\s/.test(c)) return null
    }
    return null
  }

  /** The text with the `@query` run removed, closing the gap it leaves behind. */
  static consume(text: string, mention: ActiveMention): string {
    const before = text.slice(0, mention.start)
    const after = text.slice(mention.start + 1 + mention.query.length)
    // The run sat between these two. Joining them directly would leave the
    // space that preceded the `@` beside the one that followed the run, so a
    // mid-sentence mention has to close its own gap; a leading one just leaves
    // whitespace at the front.
    const joined = /\s$/.test(before) ? before + after.replace(/^\s+/, '') : before + after
    return joined.replace(/^\s+/, '')
  }
}
