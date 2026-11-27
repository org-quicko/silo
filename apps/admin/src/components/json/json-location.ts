import { jsonLanguage } from '@codemirror/lang-json'
import type { JsonDiagnostic } from './json-syntax'

export interface JsonPathSpan {
  keyFrom?: number
  keyTo?: number
  valueFrom: number
  valueTo: number
}

interface TreeCursorNode {
  name: string
  from: number
  to: number
  firstChild: TreeCursorNode | null
  nextSibling: TreeCursorNode | null
}

const VALUE_NODE_NAMES = new Set([
  'Object',
  'Array',
  'String',
  'Number',
  'True',
  'False',
  'Null',
])

/**
 * Indexes exact character spans in a JSON document by RFC 6901 JSON Pointer
 * using CodeMirror's `@codemirror/lang-json` Lezer tree and precomputes line
 * offsets for accurate CRLF/UTF-16 line & column diagnostics.
 */
export class JsonLocation {
  private readonly text: string
  private readonly spans: Map<string, JsonPathSpan>
  private readonly lineStarts: number[]

  private constructor(
    text: string,
    spans: Map<string, JsonPathSpan>,
    lineStarts: number[],
  ) {
    this.text = text
    this.spans = spans
    this.lineStarts = lineStarts
  }

  static index(text: string): JsonLocation {
    const lineStarts = JsonLocation.computeLineStarts(text)
    const spans = new Map<string, JsonPathSpan>()
    const tree = jsonLanguage.parser.parse(text)
    const rootNode = tree.topNode as unknown as TreeCursorNode
    const rootValue = JsonLocation.firstValueChild(rootNode)
    if (rootValue) {
      JsonLocation.visitValue(text, rootValue, '', undefined, undefined, spans)
    }
    return new JsonLocation(text, spans, lineStarts)
  }

  /**
   * Finds JSON `Number` tokens that overflow IEEE-754 (`Infinity`, which
   * `JSON.stringify` silently turns into `null`) or integer tokens that lose
   * precision when parsed to a JS `number`.
   */
  static findUnsafeNumbers(text: string): JsonDiagnostic[] {
    const lineStarts = JsonLocation.computeLineStarts(text)
    const locator = new JsonLocation(text, new Map(), lineStarts)
    const tree = jsonLanguage.parser.parse(text)
    const diagnostics: JsonDiagnostic[] = []

    tree.iterate({
      enter(node) {
        if (node.name !== 'Number') return
        const raw = text.slice(node.from, node.to)
        const parsed = Number(raw)
        if (!Number.isFinite(parsed)) {
          diagnostics.push(
            locator.buildDiagnostic(
              node.from,
              node.to,
              `Number "${raw}" overflows JSON finite range and would serialize as null.`,
            ),
          )
          return
        }
        if (/^-?(0|[1-9][0-9]*)$/.test(raw) && !Number.isSafeInteger(parsed)) {
          try {
            if (BigInt(raw) !== BigInt(parsed)) {
              diagnostics.push(
                locator.buildDiagnostic(
                  node.from,
                  node.to,
                  `Integer "${raw}" exceeds 53-bit precision and would be rounded to ${parsed}.`,
                ),
              )
            }
          } catch {
            /* ignore malformed BigInt input */
          }
        }
      },
    })

    return diagnostics
  }

  static escapeSegment(segment: string | number): string {
    return String(segment).replace(/~/g, '~0').replace(/\//g, '~1')
  }

  static pointerFor(path: readonly (string | number)[]): string {
    if (path.length === 0) return ''
    return `/${path.map((segment) => JsonLocation.escapeSegment(segment)).join('/')}`
  }

  spanOf(pointer: string): JsonPathSpan | null {
    return this.spans.get(pointer) ?? null
  }

  positionOf(offset: number): { line: number; column: number } {
    const clamped = Math.max(0, Math.min(offset, this.text.length))
    let low = 0
    let high = this.lineStarts.length - 1
    while (low <= high) {
      const mid = (low + high) >> 1
      if (this.lineStarts[mid] <= clamped) {
        low = mid + 1
      } else {
        high = mid - 1
      }
    }
    const lineIndex = Math.max(0, high)
    return {
      line: lineIndex + 1,
      column: clamped - this.lineStarts[lineIndex] + 1,
    }
  }

  diagnosticForKey(pointer: string, message: string): JsonDiagnostic {
    const span = this.spans.get(pointer)
    if (span && span.keyFrom !== undefined && span.keyTo !== undefined) {
      return this.buildDiagnostic(span.keyFrom, span.keyTo, message)
    }
    if (span) {
      return this.buildDiagnostic(span.valueFrom, span.valueTo, message)
    }
    return this.fallbackDiagnostic(message)
  }

  diagnosticForValue(pointer: string, message: string): JsonDiagnostic {
    const span = this.spans.get(pointer)
    if (span) {
      return this.buildDiagnostic(span.valueFrom, span.valueTo, message)
    }
    return this.fallbackDiagnostic(message)
  }

  diagnosticForObjectAnchor(pointer: string, message: string): JsonDiagnostic {
    const span = this.spans.get(pointer)
    if (span && span.valueTo > span.valueFrom) {
      const anchorFrom = Math.max(span.valueFrom, span.valueTo - 1)
      return this.buildDiagnostic(anchorFrom, span.valueTo, message)
    }
    return this.fallbackDiagnostic(message)
  }

  private buildDiagnostic(from: number, to: number, message: string): JsonDiagnostic {
    const clampedFrom = Math.max(0, Math.min(from, this.text.length))
    const clampedTo = Math.max(clampedFrom, Math.min(to, this.text.length))
    const location = this.positionOf(clampedFrom)
    return {
      message,
      from: clampedFrom,
      to: clampedTo,
      line: location.line,
      column: location.column,
    }
  }

  private fallbackDiagnostic(message: string): JsonDiagnostic {
    const to = this.text.length > 0 ? 1 : 0
    return this.buildDiagnostic(0, to, message)
  }

  private static computeLineStarts(text: string): number[] {
    const starts = [0]
    for (let index = 0; index < text.length; index++) {
      if (text.charCodeAt(index) === 10) {
        starts.push(index + 1)
      }
    }
    return starts
  }

  private static firstValueChild(node: TreeCursorNode): TreeCursorNode | null {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (VALUE_NODE_NAMES.has(child.name)) return child
    }
    return null
  }

  private static visitValue(
    text: string,
    node: TreeCursorNode,
    pointer: string,
    keyFrom: number | undefined,
    keyTo: number | undefined,
    spans: Map<string, JsonPathSpan>,
  ): void {
    spans.set(pointer, {
      keyFrom,
      keyTo,
      valueFrom: node.from,
      valueTo: node.to,
    })

    if (node.name === 'Object') {
      for (let child = node.firstChild; child; child = child.nextSibling) {
        if (child.name !== 'Property') continue
        let propertyKeyNode: TreeCursorNode | null = null
        let propertyValueNode: TreeCursorNode | null = null
        for (let part = child.firstChild; part; part = part.nextSibling) {
          if (part.name === 'PropertyName') {
            propertyKeyNode = part
          } else if (VALUE_NODE_NAMES.has(part.name)) {
            propertyValueNode = part
          }
        }
        if (!propertyKeyNode || !propertyValueNode) continue
        const decodedKey = JsonLocation.decodePropertyName(
          text.slice(propertyKeyNode.from, propertyKeyNode.to),
        )
        if (decodedKey === null) continue
        const childPointer = `${pointer}/${JsonLocation.escapeSegment(decodedKey)}`
        JsonLocation.visitValue(
          text,
          propertyValueNode,
          childPointer,
          propertyKeyNode.from,
          propertyKeyNode.to,
          spans,
        )
      }
      return
    }

    if (node.name === 'Array') {
      let itemIndex = 0
      for (let child = node.firstChild; child; child = child.nextSibling) {
        if (!VALUE_NODE_NAMES.has(child.name)) continue
        const childPointer = `${pointer}/${itemIndex}`
        JsonLocation.visitValue(text, child, childPointer, undefined, undefined, spans)
        itemIndex++
      }
    }
  }

  private static decodePropertyName(raw: string): string | null {
    try {
      const parsed = JSON.parse(raw)
      return typeof parsed === 'string' ? parsed : null
    } catch {
      return null
    }
  }
}
