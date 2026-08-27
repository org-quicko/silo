import type { SearchSnippet } from '../../api/types/search-snippet'

/**
 * Fits a snippet into a single narrow line.
 *
 * The server windows a fixed number of characters either side of the match
 * (D30), which is right for an API and too wide for a table cell: with the
 * line clipped at its right edge, a long lead pushes the matched run out of
 * sight, and a snippet that does not show its match explains nothing. So the
 * lead is trimmed here, in the layer that knows how much room there is.
 */
export class SnippetView {
  static readonly DefaultLead = 24

  static clamp(snippet: SearchSnippet, lead = SnippetView.DefaultLead): SearchSnippet {
    if (snippet.before.length <= lead) return snippet
    // Trimmed from the left: the characters next to the match are the ones
    // that give it context, so they are the ones worth keeping.
    return { ...snippet, before: '…' + snippet.before.slice(-lead).replace(/^…\s*/, '') }
  }
}
