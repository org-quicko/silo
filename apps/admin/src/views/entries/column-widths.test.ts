import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { ColumnWidths } from './column-widths'

describe('ColumnWidths.template', () => {
  test('a column nobody dragged keeps its proportional track', () => {
    expect(ColumnWidths.template(['status'], {})).toBe('minmax(0,1.9fr) minmax(0,1fr) minmax(0,0.8fr) 44px')
  })

  test('a dragged column is fixed, its neighbours are not', () => {
    const widths = { [ColumnWidths.PrimaryKey]: 300, status: 120 }
    expect(ColumnWidths.template(['status', 'amount'], widths)).toBe('300px 120px minmax(0,1fr) minmax(0,0.8fr) 44px')
  })
})

describe('ColumnWidths.max', () => {
  test('leaves every other column its minimum, and the actions cell its width', () => {
    // 1000 - 44 actions - 3 * 72 for the columns that are not being dragged
    expect(ColumnWidths.max(1000, 4)).toBe(1000 - 44 - 216)
  })

  test('never returns less than the minimum, however narrow the table', () => {
    expect(ColumnWidths.max(200, 6)).toBe(ColumnWidths.Min)
  })
})

describe('ColumnWidths.clamp', () => {
  test('holds a drag between the minimum and the table it has to fit in', () => {
    expect(ColumnWidths.clamp(10, 500)).toBe(ColumnWidths.Min)
    expect(ColumnWidths.clamp(240.4, 500)).toBe(240)
    expect(ColumnWidths.clamp(900, 500)).toBe(500)
  })

  test('a max below the minimum still yields a usable column', () => {
    expect(ColumnWidths.clamp(300, 10)).toBe(ColumnWidths.Min)
  })
})

describe('ColumnWidths storage', () => {
  const key = ColumnWidths.key('s1', 'p', 'dev', 'people')
  // Bun's test runtime has no DOM; the class only needs get/set.
  let store: Record<string, string>

  beforeEach(() => {
    store = {}
    ;(globalThis as any).localStorage = {
      getItem: (name: string) => (name in store ? store[name] : null),
      setItem: (name: string, value: string) => {
        store[name] = value
      },
    }
  })

  afterEach(() => {
    delete (globalThis as any).localStorage
  })

  test('round-trips one table without touching another', () => {
    ColumnWidths.write(key, { status: 140 })
    ColumnWidths.write(ColumnWidths.key('s1', 'p', 'dev', 'orders'), { status: 300 })
    expect(ColumnWidths.read(key)).toEqual({ status: 140 })
  })

  test('drops a width that is not a usable number rather than repairing it', () => {
    localStorage.setItem('silo_column_widths', JSON.stringify({ [key]: { a: 'wide', b: 12, c: 140.6 } }))
    expect(ColumnWidths.read(key)).toEqual({ c: 141 })
  })

  test('an emptied table leaves nothing behind', () => {
    ColumnWidths.write(key, { status: 140 })
    ColumnWidths.write(key, {})
    expect(ColumnWidths.read(key)).toEqual({})
    expect(JSON.parse(localStorage.getItem('silo_column_widths') || '{}')[key]).toBeUndefined()
  })

  test('unreadable storage reads as no preference at all', () => {
    localStorage.setItem('silo_column_widths', 'not json')
    expect(ColumnWidths.read(key)).toEqual({})
  })
})
