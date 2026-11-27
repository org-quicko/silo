import { JsonLocation } from './json-location'

export interface JsonDiagnostic {
  message: string
  from: number
  to: number
  line: number
  column: number
}

/**
 * Pure JSON diagnostics, formatting, minification, key sorting, and summary
 * helpers shared across form fields, entry JSON mode, and schema Code mode.
 */
export class JsonSyntax {
  static diagnose(text: string, options?: { allowEmpty?: boolean }): JsonDiagnostic | null {
    if (text.trim() === '') {
      if (options?.allowEmpty) return null
      return { message: 'JSON cannot be empty.', from: 0, to: 0, line: 1, column: 1 }
    }

    try {
      JSON.parse(text)
      return null
    } catch (caught) {
      const rawMessage = caught instanceof Error ? caught.message : 'Invalid JSON'
      const rawOffset = JsonSyntax.extractErrorOffset(text, rawMessage)
      const clampedOffset = Math.max(0, Math.min(rawOffset, text.length))
      let from = clampedOffset
      let to = clampedOffset < text.length ? clampedOffset + 1 : text.length
      if (from === text.length && text.length > 0) {
        from = text.length - 1
        to = text.length
      }
      const location = JsonSyntax.positionToLineColumn(text, from)
      return {
        message: rawMessage,
        from,
        to,
        line: location.line,
        column: location.column,
      }
    }
  }

  static diagnoseKey(text: string, key: string, message: string): JsonDiagnostic {
    const quoted = JSON.stringify(key)
    let searchFrom = 0
    while (searchFrom < text.length) {
      const matchIndex = text.indexOf(quoted, searchFrom)
      if (matchIndex === -1) break
      let cursor = matchIndex + quoted.length
      while (cursor < text.length && /\s/.test(text[cursor])) {
        cursor++
      }
      if (text[cursor] === ':') {
        const location = JsonSyntax.positionToLineColumn(text, matchIndex)
        return {
          message,
          from: matchIndex,
          to: matchIndex + quoted.length,
          line: location.line,
          column: location.column,
        }
      }
      searchFrom = matchIndex + quoted.length
    }

    return {
      message,
      from: 0,
      to: Math.min(1, text.length),
      line: 1,
      column: 1,
    }
  }

  static positionToLineColumn(text: string, offset: number): { line: number; column: number } {
    const clamped = Math.max(0, Math.min(offset, text.length))
    let line = 1
    let lineStart = 0
    for (let index = 0; index < clamped; index++) {
      if (text.charCodeAt(index) === 10) {
        line++
        lineStart = index + 1
      }
    }
    return { line, column: clamped - lineStart + 1 }
  }

  static lineColumnToOffset(text: string, line: number, column: number): number {
    const targetLine = Math.max(1, line)
    const targetColumn = Math.max(1, column)
    let currentLine = 1
    let index = 0
    while (index < text.length && currentLine < targetLine) {
      if (text.charCodeAt(index) === 10) {
        currentLine++
      }
      index++
    }
    let lineEnd = text.indexOf('\n', index)
    if (lineEnd === -1) lineEnd = text.length
    return Math.min(index + targetColumn - 1, lineEnd)
  }

  static format(
    text: string,
    indent = 2,
  ): { ok: true; text: string } | { ok: false; diagnostic: JsonDiagnostic } {
    const diagnostic = JsonSyntax.diagnose(text)
    if (diagnostic) return { ok: false, diagnostic }
    const unsafe = JsonLocation.findUnsafeNumbers(text)
    if (unsafe.length > 0) return { ok: false, diagnostic: unsafe[0] }
    return { ok: true, text: JSON.stringify(JSON.parse(text), null, indent) }
  }

  static minify(text: string): { ok: true; text: string } | { ok: false; diagnostic: JsonDiagnostic } {
    const diagnostic = JsonSyntax.diagnose(text)
    if (diagnostic) return { ok: false, diagnostic }
    const unsafe = JsonLocation.findUnsafeNumbers(text)
    if (unsafe.length > 0) return { ok: false, diagnostic: unsafe[0] }
    return { ok: true, text: JSON.stringify(JSON.parse(text)) }
  }

  static sortKeys(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => JsonSyntax.sortKeys(item))
    }
    if (value !== null && typeof value === 'object') {
      const record = value as Record<string, unknown>
      const sortedEntries = Object.keys(record)
        .sort((left, right) => left.localeCompare(right))
        .map((key) => [key, JsonSyntax.sortKeys(record[key])] as const)
      return Object.fromEntries(sortedEntries)
    }
    return value
  }

  static sortKeysInText(
    text: string,
    indent = 2,
  ): { ok: true; text: string } | { ok: false; diagnostic: JsonDiagnostic } {
    const diagnostic = JsonSyntax.diagnose(text)
    if (diagnostic) return { ok: false, diagnostic }
    const unsafe = JsonLocation.findUnsafeNumbers(text)
    if (unsafe.length > 0) return { ok: false, diagnostic: unsafe[0] }
    const sorted = JsonSyntax.sortKeys(JSON.parse(text))
    return { ok: true, text: JSON.stringify(sorted, null, indent) }
  }

  static summarize(value: unknown): string {
    if (value === undefined) return 'empty'
    if (value === null) return 'null'
    if (typeof value === 'boolean') return value ? 'true' : 'false'
    if (typeof value === 'number') return String(value)
    if (typeof value === 'string') {
      const compact = value.replace(/\s+/g, ' ').trim()
      if (compact.length <= 24) return JSON.stringify(compact)
      return JSON.stringify(`${compact.slice(0, 21)}…`)
    }
    if (Array.isArray(value)) {
      if (value.length === 0) return '[]'
      return value.length === 1 ? '[1 item]' : `[${value.length} items]`
    }
    if (typeof value === 'object') {
      const count = Object.keys(value as Record<string, unknown>).length
      if (count === 0) return '{}'
      return count === 1 ? '{1 key}' : `{${count} keys}`
    }
    return 'unknown'
  }

  static measure(text: string): { lines: number; bytes: number } {
    const lines = text.length === 0 ? 0 : text.split('\n').length
    const bytes = new TextEncoder().encode(text).length
    return { lines, bytes }
  }

  private static extractErrorOffset(text: string, message: string): number {
    const lineColumnMatch = message.match(/line\s+(\d+)\s+column\s+(\d+)/i)
    if (lineColumnMatch) {
      const line = Number(lineColumnMatch[1])
      const column = Number(lineColumnMatch[2])
      if (Number.isFinite(line) && Number.isFinite(column)) {
        return JsonSyntax.lineColumnToOffset(text, line, column)
      }
    }

    const positionMatch = message.match(/at\s+position\s+(\d+)/i)
    if (positionMatch) {
      const position = Number(positionMatch[1])
      if (Number.isFinite(position)) {
        return position
      }
    }

    if (/unexpected end|eof|unterminated/i.test(message)) {
      for (let index = text.length - 1; index >= 0; index--) {
        if (!/\s/.test(text[index])) {
          return index
        }
      }
      return 0
    }

    return 0
  }
}
