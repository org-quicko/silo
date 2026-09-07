import { describe, test, expect } from 'bun:test'
import { ColumnLabel } from './column-label'

describe('ColumnLabel', () => {
  test('capitalizes a plain lowercase field', () => {
    expect(ColumnLabel.of('title')).toBe('Title')
  })

  test('spaces out snake_case', () => {
    expect(ColumnLabel.of('author_name')).toBe('Author Name')
  })

  test('spaces out camelCase', () => {
    expect(ColumnLabel.of('authorName')).toBe('Author Name')
  })

  test('spaces out kebab-case', () => {
    expect(ColumnLabel.of('author-name')).toBe('Author Name')
  })

  test('leaves an already Title Case field alone', () => {
    expect(ColumnLabel.of('Author Name')).toBe('Author Name')
  })

  test('handles a short all-caps acronym field', () => {
    expect(ColumnLabel.of('sku')).toBe('Sku')
  })
})
