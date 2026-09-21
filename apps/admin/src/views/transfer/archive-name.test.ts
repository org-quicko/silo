import { describe, test, expect } from 'bun:test'
import { ArchiveName } from './archive-name'
describe('ArchiveName', () => {
  test('stamps a sortable UTC instant', () => {
    expect(ArchiveName.of(new Date('2026-09-17T06:12:58.412Z'))).toBe('silo-export-20260917T061258Z.tar.gz')
  })
  test('sorts lexically in the order taken', () => {
    const a = ArchiveName.of(new Date('2026-09-17T06:12:58Z'))
    const b = ArchiveName.of(new Date('2026-09-17T18:04:01Z'))
    expect([b, a].sort()).toEqual([a, b])
  })
})
