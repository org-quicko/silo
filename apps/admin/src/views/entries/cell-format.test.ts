import { describe, expect, test } from 'bun:test'
import { CellFormat } from './cell-format'

describe('CellFormat', () => {
  describe('isMediaField', () => {
    test('identifies x-silo-type: media', () => {
      expect(CellFormat.isMediaField({ 'x-silo-type': 'media' })).toBeTrue()
    })

    test('identifies x-silo-ui widget: media', () => {
      expect(CellFormat.isMediaField({ 'x-silo-ui': { widget: 'media' } })).toBeTrue()
    })

    test('identifies format: uri with widget: media', () => {
      expect(
        CellFormat.isMediaField({
          type: 'string',
          format: 'uri',
          'x-silo-ui': { widget: 'media' },
        }),
      ).toBeTrue()
    })

    test('returns false for plain string or non-media props', () => {
      expect(CellFormat.isMediaField({ type: 'string' })).toBeFalse()
      expect(CellFormat.isMediaField(undefined)).toBeFalse()
      expect(CellFormat.isMediaField(null)).toBeFalse()
    })
  })

  describe('formatUri', () => {
    test('formats URL by dropping scheme and query', () => {
      expect(CellFormat.formatUri('https://silo.dev/docs/pricing?x=1')).toBe('silo.dev/docs/pricing')
    })
  })

  describe('formatNumber', () => {
    test('formats number with multipleOf decimals', () => {
      expect(CellFormat.formatNumber(12.345, 0.01)).toBe('12.35')
    })
  })
})
