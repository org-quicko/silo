import { describe, expect, test } from 'bun:test'
import type { MediaAsset } from '../../api/types/media-asset'
import { validateMove } from './use-media-move-flow'

const mockAsset = (patch: Partial<MediaAsset> = {}): MediaAsset => ({
  id: 'a1',
  filename: 'image.png',
  folder: '',
  blob_key: 'a1.png',
  size: 1024,
  content_type: 'image/png',
  hash: 'abc',
  state: 'active',
  tags: [],
  url: '/media/a1',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  ...patch,
})

describe('validateMove', () => {
  test('rejects empty subject', () => {
    const result = validateMove({ assets: [], folderPaths: [] }, '/target')
    expect(result.valid).toBe(false)
  })

  test('prevents moving a folder into itself', () => {
    const result = validateMove({ assets: [], folderPaths: ['/heroes'] }, '/heroes')
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('into itself')
  })

  test('prevents moving a folder into its own subfolder', () => {
    const result = validateMove({ assets: [], folderPaths: ['/heroes'] }, '/heroes/2026')
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('into one of its subfolders')
  })

  test('allows moving a folder to another unrelated folder or root', () => {
    const resultToUnrelated = validateMove({ assets: [], folderPaths: ['/heroes/2026'] }, '/archive')
    expect(resultToUnrelated.valid).toBe(true)

    const resultToRoot = validateMove({ assets: [], folderPaths: ['/heroes/2026'] }, '')
    expect(resultToRoot.valid).toBe(true)
  })

  test('prevents moving an asset if already in target folder', () => {
    const asset = mockAsset({ folder: '/heroes' })
    const result = validateMove({ assets: [asset], folderPaths: [] }, '/heroes')
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('already in this folder')
  })

  test('allows moving an asset to a different folder or root', () => {
    const asset = mockAsset({ folder: '/heroes' })
    const result = validateMove({ assets: [asset], folderPaths: [] }, '/banners')
    expect(result.valid).toBe(true)

    const resultRoot = validateMove({ assets: [asset], folderPaths: [] }, '')
    expect(resultRoot.valid).toBe(true)
  })

  test('validates mixed move subjects correctly', () => {
    const asset1 = mockAsset({ id: 'a1', folder: '' })
    const resultValid = validateMove(
      { assets: [asset1], folderPaths: ['/heroes/2026'] },
      '/archive',
    )
    expect(resultValid.valid).toBe(true)

    const resultInvalidCycle = validateMove(
      { assets: [asset1], folderPaths: ['/heroes'] },
      '/heroes/sub',
    )
    expect(resultInvalidCycle.valid).toBe(false)
  })
})
