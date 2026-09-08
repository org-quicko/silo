import { VariableTemplate } from '@silo/shared/variable-template'
import type { Variable } from '../../api/types/variable'

/** What one `{{NAME}}` in a field resolves to, from the editor's point of view. */
export interface VariableHint {
  name: string
  /**
   * `resolved` — declared here and valued, so the API substitutes it.
   * `unset` — declared in the project, but this environment has no value, so
   * the API returns the reference unchanged.
   * `undeclared` — nothing by this name exists, most often a typo.
   */
  state: 'resolved' | 'unset' | 'undeclared'
  /** Only for `resolved`. The other two states have nothing to show. */
  value: string | null
}

/** A name being typed inside an unclosed `{{`, and where it sits. */
export interface VariableDraft {
  /** What has been typed after the braces so far, possibly empty. */
  prefix: string
  /** Index of the `{` that opened it. */
  start: number
  /** Index one past the caret, where a completion is inserted up to. */
  end: number
}

/**
 * The pure half of the entry form's variable affordance (D57).
 *
 * Split out for the reason `media-delete-outcome.ts` and `PluginGrantPlan` are:
 * what a field should show about a reference, and what a completion should
 * insert, are rules worth testing without mounting a form. The components
 * beside this file own only the drawing.
 */
export class VariableHints {
  /**
   * One hint per **distinct** reference in `text`, in first-seen order.
   *
   * Distinct, because a field mentioning `{{API_URL}}` three times is one fact
   * about that field, not three; the reader wants to know what it resolves to,
   * not how often they typed it.
   */
  static of(text: unknown, variables: readonly Variable[]): VariableHint[] {
    if (typeof text !== 'string') return []

    const declared = new Map(variables.map((variable) => [variable.name, variable]))
    return VariableTemplate.names(text).map((name) => {
      const variable = declared.get(name)
      if (!variable) return { name, state: 'undeclared' as const, value: null }
      if (variable.value === null) return { name, state: 'unset' as const, value: null }
      return { name, state: 'resolved' as const, value: variable.value }
    })
  }

  /**
   * The name being typed at `caret`, or null when the caret is not inside an
   * unclosed `{{`.
   *
   * Scans **backwards** from the caret rather than matching the whole field,
   * because the question is about one position and a field may hold several
   * references. The scan stops at the first `}` or `{` it meets going left, so
   * a caret sitting after a *closed* `{{X}}` offers nothing — there is nothing
   * left to complete there.
   */
  static draftAt(text: string, caret: number): VariableDraft | null {
    if (typeof text !== 'string' || caret < 2) return null

    for (let index = caret - 1; index >= 1; index -= 1) {
      const character = text[index]!
      if (character === '}') return null
      if (character === '{') {
        // A single `{` is not an opener; `{{` is.
        if (text[index - 1] !== '{') return null
        const prefix = text.slice(index + 1, caret)
        // Anything that could not become a name means the caret is inside
        // something else that happens to follow braces.
        if (!/^[A-Za-z0-9_]*$/.test(prefix)) return null
        return { prefix, start: index - 1, end: caret }
      }
      // A name in progress is the only thing allowed between the braces and the
      // caret; a space or a symbol ends the search.
      if (!/[A-Za-z0-9_]/.test(character)) return null
    }
    return null
  }

  /** The declared names a draft prefix matches, most useful first. */
  static suggestions(
    draft: VariableDraft,
    variables: readonly Variable[],
    limit = 6,
  ): Variable[] {
    const prefix = draft.prefix.toLowerCase()
    // Prefix matches first, then anything containing it — so typing `URL`
    // still finds `API_URL`, without burying an exact prefix match under it.
    const starts: Variable[] = []
    const contains: Variable[] = []
    for (const variable of variables) {
      const name = variable.name.toLowerCase()
      if (prefix === '' || name.startsWith(prefix)) starts.push(variable)
      else if (name.includes(prefix)) contains.push(variable)
    }
    return [...starts, ...contains].slice(0, limit)
  }

  /**
   * `text` with the draft completed to `name`, and where the caret lands.
   *
   * The closing braces are only added when they are not already there, so
   * completing inside a reference somebody half-typed as `{{API}}` does not
   * leave `{{API_URL}}}}`.
   */
  static complete(
    text: string,
    draft: VariableDraft,
    name: string,
  ): { text: string; caret: number } {
    const alreadyClosed = text.slice(draft.end, draft.end + 2) === '}}'
    const inserted = alreadyClosed
      ? VariableTemplate.spell(name).slice(0, -2)
      : VariableTemplate.spell(name)
    const tail = text.slice(draft.end)
    return {
      text: text.slice(0, draft.start) + inserted + tail,
      caret: draft.start + inserted.length + (alreadyClosed ? 2 : 0),
    }
  }
}
