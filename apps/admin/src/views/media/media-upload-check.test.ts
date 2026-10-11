import { describe, expect, test } from 'bun:test'
import { MediaUploadCheck } from './media-upload-check'
import type { MediaUploadPlan } from './media-upload-plan'

function planOf(folders: string[], emptyFolders: string[] = []): MediaUploadPlan {
  return { uploads: folders.map((folder) => ({ file: new File(['x'], 'a.png'), folder })), emptyFolders }
}

describe('MediaUploadCheck.problem', () => {
  test('passes a tree of ordinary names, and files with no folder at all', () => {
    expect(MediaUploadCheck.problem(planOf(['', 'photos', 'photos/2024', 'Q1 report']), '')).toBeNull()
  })

  test('names the first segment the server would refuse', () => {
    expect(MediaUploadCheck.problem(planOf(['site', 'site/_assets']), '')).toBe('invalid folder segment "_assets"')
    expect(MediaUploadCheck.problem(planOf(['Résumé']), '/docs')).toBe('invalid folder segment "Résumé"')
  })

  test('looks at empty folders as well as at the folders of files', () => {
    expect(MediaUploadCheck.problem(planOf(['ok'], ['ok/.cache']), '')).toBe('invalid folder segment ".cache"')
  })

  test('counts the destination toward the depth limit', () => {
    const deep = Array.from({ length: 8 }, (_, index) => `d${index}`)
    const within = deep.join('/')
    const destination = `/${deep.join('/')}`
    expect(MediaUploadCheck.problem(planOf([within]), destination)).toBeNull()
    expect(MediaUploadCheck.problem(planOf([`${within}/one-more`]), destination)).toBe(
      'folder is deeper than 16 levels',
    )
  })
})
