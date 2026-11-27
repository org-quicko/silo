import { describe, expect, test } from 'bun:test'
import { MediaDrop } from './media-drop'

function fakeFileList(files: File[]): FileList {
  const list: Record<number, File> & { length: number; item(index: number): File | null } = {
    length: files.length,
    item: (index: number) => files[index] ?? null,
  }
  files.forEach((file, index) => {
    list[index] = file
  })
  return list as unknown as FileList
}

describe('MediaDrop', () => {
  const imageFile = new File(['png'], 'hero.png', { type: 'image/png' })
  const secondFile = new File(['txt'], 'notes.txt', { type: 'text/plain' })

  test('accepts drag only when enabled and transfer carries Files', () => {
    expect(MediaDrop.canAcceptDrag({ files: fakeFileList([]), types: ['Files'] }, true)).toBe(true)
    expect(MediaDrop.canAcceptDrag({ files: fakeFileList([imageFile]), types: [] }, true)).toBe(true)
    expect(MediaDrop.canAcceptDrag({ files: fakeFileList([]), types: ['text/plain'] }, true)).toBe(false)
    expect(MediaDrop.canAcceptDrag({ files: fakeFileList([]), types: ['Files'] }, false)).toBe(false)
    expect(MediaDrop.canAcceptDrag(null, true)).toBe(false)
  })

  test('extracts the first dropped file only when enabled', () => {
    const transfer = { files: fakeFileList([imageFile, secondFile]) }
    expect(MediaDrop.droppedFile(transfer, true)).toBe(imageFile)
    expect(MediaDrop.droppedFile(transfer, false)).toBeNull()
    expect(MediaDrop.droppedFile({ files: fakeFileList([]) }, true)).toBeNull()
    expect(MediaDrop.droppedFile(null, true)).toBeNull()
  })

  test('extracts pasted file only when files are present and upload is enabled', () => {
    expect(MediaDrop.pastedFile({ files: fakeFileList([imageFile]) }, true)).toBe(imageFile)
    expect(MediaDrop.pastedFile({ files: fakeFileList([]) }, true)).toBeNull()
    expect(MediaDrop.pastedFile({ files: fakeFileList([imageFile]) }, false)).toBeNull()
    expect(MediaDrop.pastedFile(undefined, true)).toBeNull()
  })

  test('detects leaving container while ignoring child transitions', () => {
    const child = { kind: 'child' }
    const outside = { kind: 'outside' }
    const contains = (target: unknown) => target === child

    expect(MediaDrop.leftTarget(contains, child)).toBe(false)
    expect(MediaDrop.leftTarget(contains, outside)).toBe(true)
    expect(MediaDrop.leftTarget(contains, null)).toBe(true)
  })
})
