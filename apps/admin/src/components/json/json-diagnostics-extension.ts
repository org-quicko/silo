import {
  Decoration,
  EditorSelection,
  EditorView,
  GutterMarker,
  RangeSet,
  StateEffect,
  StateField,
  gutter,
  hoverTooltip,
  type DecorationSet,
  type Extension,
  type Range,
} from '@uiw/react-codemirror'
import type { JsonDiagnostic } from './json-syntax'

class ErrorGutterMarker extends GutterMarker {
  private readonly message: string

  constructor(message: string) {
    super()
    this.message = message
  }

  override toDOM(): HTMLElement {
    const marker = document.createElement('span')
    marker.className = 'cm-json-error-dot'
    marker.title = this.message
    marker.setAttribute('aria-label', this.message)
    return marker
  }

  override eq(other: GutterMarker): boolean {
    return other instanceof ErrorGutterMarker && other.message === this.message
  }
}

/**
 * CodeMirror 6 multi-diagnostic highlights, line-grouped gutter dots, span-aware
 * hover tooltips, and jump-to-error commands backed by `@uiw/react-codemirror`.
 */
export class JsonDiagnosticsExtension {
  static readonly setDiagnostics = StateEffect.define<readonly JsonDiagnostic[]>()

  static readonly field = StateField.define<readonly JsonDiagnostic[]>({
    create: () => [],
    update(value, transaction) {
      for (const effect of transaction.effects) {
        if (effect.is(JsonDiagnosticsExtension.setDiagnostics)) {
          return JsonDiagnosticsExtension.sort(effect.value)
        }
      }
      if (transaction.docChanged && value.length > 0) {
        const docLength = transaction.newDoc.length
        return value.map((item) => {
          const mappedFrom = Math.max(
            0,
            Math.min(transaction.changes.mapPos(Math.min(item.from, transaction.startState.doc.length), 1), docLength),
          )
          const mappedTo = Math.max(
            mappedFrom,
            Math.min(transaction.changes.mapPos(Math.min(item.to, transaction.startState.doc.length), -1), docLength),
          )
          return { ...item, from: mappedFrom, to: mappedTo }
        })
      }
      return value
    },
  })

  static extensions(): Extension[] {
    const decorations = EditorView.decorations.compute([JsonDiagnosticsExtension.field], (state) => {
      const diagnostics = state.field(JsonDiagnosticsExtension.field, false) ?? []
      if (diagnostics.length === 0) return Decoration.none

      const docLength = state.doc.length
      const lineStartsSeen = new Set<number>()
      const ranges: Range<Decoration>[] = []

      for (const diagnostic of diagnostics) {
        const from = Math.max(0, Math.min(diagnostic.from, docLength))
        const to = Math.max(from, Math.min(diagnostic.to, docLength))
        const line = state.doc.lineAt(from)
        if (!lineStartsSeen.has(line.from)) {
          lineStartsSeen.add(line.from)
          ranges.push(Decoration.line({ class: 'cm-json-error-line' }).range(line.from))
        }
        if (from < to) {
          ranges.push(Decoration.mark({ class: 'cm-json-error-mark' }).range(from, to))
        }
      }

      return Decoration.set(ranges, true) as DecorationSet
    })

    const errorGutter = gutter({
      class: 'cm-json-error-gutter',
      markers(view) {
        const diagnostics = view.state.field(JsonDiagnosticsExtension.field, false) ?? []
        if (diagnostics.length === 0) return RangeSet.empty

        const docLength = view.state.doc.length
        const byLine = new Map<number, string[]>()
        for (const diagnostic of diagnostics) {
          const pos = Math.max(0, Math.min(diagnostic.from, docLength))
          const line = view.state.doc.lineAt(pos)
          const list = byLine.get(line.from) ?? []
          list.push(diagnostic.message)
          byLine.set(line.from, list)
        }

        const markers = [...byLine.entries()]
          .sort(([leftFrom], [rightFrom]) => leftFrom - rightFrom)
          .map(([lineFrom, messages]) =>
            new ErrorGutterMarker(messages.join('\n')).range(lineFrom),
          )

        return RangeSet.of(markers)
      },
    })

    const errorTooltip = hoverTooltip((view, pos) => {
      const diagnostics = view.state.field(JsonDiagnosticsExtension.field, false) ?? []
      if (diagnostics.length === 0) return null

      const docLength = view.state.doc.length
      const clampedPos = Math.max(0, Math.min(pos, docLength))
      const hoverLine = view.state.doc.lineAt(clampedPos)

      const exactMatches = diagnostics.filter((item) => {
        const from = Math.max(0, Math.min(item.from, docLength))
        const to = Math.max(from, Math.min(item.to, docLength))
        return clampedPos >= from && clampedPos <= to
      })

      const active =
        exactMatches.length > 0
          ? exactMatches
          : diagnostics.filter((item) => {
              const from = Math.max(0, Math.min(item.from, docLength))
              return view.state.doc.lineAt(from).number === hoverLine.number
            })

      if (active.length === 0) return null

      const first = active[0]
      const anchorFrom = Math.max(0, Math.min(first.from, docLength))
      const anchorTo = Math.max(anchorFrom, Math.min(first.to, docLength))

      return {
        pos: anchorFrom,
        end: anchorTo,
        above: true,
        create() {
          const dom = document.createElement('div')
          dom.className = 'cm-json-error-tooltip'

          const header = document.createElement('div')
          header.className = 'cm-json-error-tooltip-loc'
          header.textContent =
            active.length === 1
              ? `Line ${first.line}, Col ${first.column}`
              : `Line ${first.line} · ${active.length} issues`
          dom.append(header)

          for (const item of active) {
            const body = document.createElement('div')
            body.className = 'cm-json-error-tooltip-msg'
            body.textContent = item.message
            dom.append(body)
          }
          return { dom }
        },
      }
    })

    return [JsonDiagnosticsExtension.field, decorations, errorGutter, errorTooltip]
  }

  static sync(view: EditorView | null, diagnostics: readonly JsonDiagnostic[]): void {
    if (!view) return
    const next = JsonDiagnosticsExtension.sort(diagnostics)
    const current = view.state.field(JsonDiagnosticsExtension.field, false) ?? []
    if (JsonDiagnosticsExtension.areEqual(current, next)) {
      return
    }
    view.dispatch({ effects: JsonDiagnosticsExtension.setDiagnostics.of(next) })
  }

  static jumpTo(view: EditorView | null, diagnostic: JsonDiagnostic | null): void {
    if (!view) return
    view.contentDOM?.scrollIntoView?.({ block: 'nearest' })
    if (diagnostic) {
      const docLength = view.state.doc.length
      const from = Math.max(0, Math.min(diagnostic.from, docLength))
      const to = Math.max(from, Math.min(diagnostic.to, docLength))
      view.dispatch({
        selection: EditorSelection.range(from, to),
        effects: EditorView.scrollIntoView(from, { y: 'center' }),
      })
    }
    view.focus()
  }

  private static sort(diagnostics: readonly JsonDiagnostic[]): readonly JsonDiagnostic[] {
    if (diagnostics.length <= 1) return [...diagnostics]
    return [...diagnostics].sort((left, right) => left.from - right.from || left.to - right.to)
  }

  private static areEqual(
    left: readonly JsonDiagnostic[],
    right: readonly JsonDiagnostic[],
  ): boolean {
    if (left.length !== right.length) return false
    for (let index = 0; index < left.length; index++) {
      const a = left[index]
      const b = right[index]
      if (
        a.message !== b.message ||
        a.from !== b.from ||
        a.to !== b.to ||
        a.line !== b.line ||
        a.column !== b.column
      ) {
        return false
      }
    }
    return true
  }
}
