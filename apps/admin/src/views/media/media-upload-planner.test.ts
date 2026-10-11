import { describe, expect, test } from 'bun:test'
import { MediaUploadPlanner } from './media-upload-planner'

/** A `File` whose folder pick reports the path it sat at. */
function picked(name: string, relativePath: string): File {
  const file = new File(['x'], name)
  Object.defineProperty(file, 'webkitRelativePath', { value: relativePath })
  return file
}

function fileEntry(name: string): FileSystemFileEntry {
  return {
    isFile: true,
    isDirectory: false,
    name,
    file: (resolve: (file: File) => void) => resolve(new File(['x'], name)),
  } as unknown as FileSystemFileEntry
}

/** A directory that answers `readEntries` in batches, then with an empty one. */
function directoryEntry(name: string, children: FileSystemEntry[], batch = 2): FileSystemDirectoryEntry {
  return {
    isFile: false,
    isDirectory: true,
    name,
    createReader: () => {
      let served = 0
      return {
        readEntries: (resolve: (entries: FileSystemEntry[]) => void) => {
          resolve(children.slice(served, served + batch))
          served += batch
        },
      }
    },
  } as unknown as FileSystemDirectoryEntry
}

function dropOf(...entries: FileSystemEntry[]): DataTransfer {
  return {
    items: entries.map((entry) => ({ kind: 'file', webkitGetAsEntry: () => entry, getAsFile: () => null })),
    files: [],
  } as unknown as DataTransfer
}

const paths = (plan: { uploads: { file: File; folder: string }[] }) =>
  plan.uploads.map((upload) => `${upload.folder}|${upload.file.name}`)

describe('MediaUploadPlanner.fromFiles', () => {
  test('files with no folder go to the destination itself', () => {
    const plan = MediaUploadPlanner.fromFiles([new File(['x'], 'a.png'), new File(['x'], 'b.png')])
    expect(paths(plan)).toEqual(['|a.png', '|b.png'])
    expect(plan.emptyFolders).toEqual([])
  })

  test('a folder pick keeps each file in the directory it came from, root folder included', () => {
    const plan = MediaUploadPlanner.fromFiles([
      picked('a.png', 'photos/a.png'),
      picked('b.png', 'photos/2024/b.png'),
      picked('c.png', 'photos/2024/summer/c.png'),
    ])
    expect(paths(plan)).toEqual(['photos|a.png', 'photos/2024|b.png', 'photos/2024/summer|c.png'])
  })
})

describe('MediaUploadPlanner.fromDrop', () => {
  test('walks a dropped folder to its leaves', async () => {
    const tree = directoryEntry('photos', [
      fileEntry('a.png'),
      directoryEntry('2024', [fileEntry('b.png'), directoryEntry('summer', [fileEntry('c.png')])]),
    ])
    const plan = await MediaUploadPlanner.fromDrop(dropOf(tree))
    expect(paths(plan).sort()).toEqual(['photos/2024/summer|c.png', 'photos/2024|b.png', 'photos|a.png'])
    expect(plan.emptyFolders).toEqual([])
  })

  test('reads a directory in as many batches as it takes', async () => {
    const names = Array.from({ length: 7 }, (_, index) => `f${index}.png`)
    const plan = await MediaUploadPlanner.fromDrop(dropOf(directoryEntry('big', names.map(fileEntry), 3)))
    expect(plan.uploads.map((upload) => upload.file.name)).toEqual(names)
  })

  test('names an empty directory, and not the ones that hold something', async () => {
    const tree = directoryEntry('site', [
      directoryEntry('empty', []),
      directoryEntry('only-empty', [directoryEntry('inner', [])]),
      directoryEntry('full', [fileEntry('a.png')]),
    ])
    const plan = await MediaUploadPlanner.fromDrop(dropOf(tree))
    expect(plan.emptyFolders).toEqual(['site/empty', 'site/only-empty/inner'])
    expect(paths(plan)).toEqual(['site/full|a.png'])
  })

  test('a dropped empty folder is a plan of that folder alone', async () => {
    const plan = await MediaUploadPlanner.fromDrop(dropOf(directoryEntry('nothing', [])))
    expect(plan.uploads).toEqual([])
    expect(plan.emptyFolders).toEqual(['nothing'])
  })

  test('takes files and folders dropped together', async () => {
    const plan = await MediaUploadPlanner.fromDrop(
      dropOf(fileEntry('loose.png'), directoryEntry('set', [fileEntry('a.png')])),
    )
    expect(paths(plan)).toEqual(['|loose.png', 'set|a.png'])
  })

  test('falls back to the file list when the browser has no entry API', async () => {
    const transfer = { items: [], files: [new File(['x'], 'a.png')] } as unknown as DataTransfer
    expect(paths(await MediaUploadPlanner.fromDrop(transfer))).toEqual(['|a.png'])
  })

  test('reports a directory it cannot read', async () => {
    const broken = {
      isFile: false,
      isDirectory: true,
      name: 'locked',
      createReader: () => ({
        readEntries: (_: unknown, reject: (failure: Error) => void) => reject(new Error('no access')),
      }),
    } as unknown as FileSystemDirectoryEntry
    let message = ''
    try {
      await MediaUploadPlanner.fromDrop(dropOf(broken))
    } catch (caught) {
      message = (caught as Error).message
    }
    expect(message).toBe('no access')
  })
})
