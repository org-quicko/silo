/** Small, uncompressed ZIP archives for the self-contained desktop extension. */
export class StoredZip {
  static create(files: Record<string, string>): Uint8Array<ArrayBuffer> {
    const encoder = new TextEncoder()
    const entries = Object.entries(files).map(([path, text]) => ({
      name: encoder.encode(path),
      data: encoder.encode(text),
    }))
    const localSize = entries.reduce((size, entry) => size + 30 + entry.name.length + entry.data.length, 0)
    const directorySize = entries.reduce((size, entry) => size + 46 + entry.name.length, 0)
    const archive = new Uint8Array(localSize + directorySize + 22)
    const view = new DataView(archive.buffer)
    let offset = 0
    let directory = localSize

    for (const entry of entries) {
      const checksum = StoredZip.checksum(entry.data)
      view.setUint32(offset, 0x04034b50, true)
      view.setUint16(offset + 4, 20, true)
      view.setUint16(offset + 6, 0x0800, true)
      view.setUint16(offset + 12, 0x0021, true) // 1980-01-01, the ZIP epoch.
      view.setUint32(offset + 14, checksum, true)
      view.setUint32(offset + 18, entry.data.length, true)
      view.setUint32(offset + 22, entry.data.length, true)
      view.setUint16(offset + 26, entry.name.length, true)
      archive.set(entry.name, offset + 30)
      archive.set(entry.data, offset + 30 + entry.name.length)

      view.setUint32(directory, 0x02014b50, true)
      view.setUint16(directory + 4, 20, true)
      view.setUint16(directory + 6, 20, true)
      view.setUint16(directory + 8, 0x0800, true)
      view.setUint16(directory + 14, 0x0021, true)
      view.setUint32(directory + 16, checksum, true)
      view.setUint32(directory + 20, entry.data.length, true)
      view.setUint32(directory + 24, entry.data.length, true)
      view.setUint16(directory + 28, entry.name.length, true)
      view.setUint32(directory + 42, offset, true)
      archive.set(entry.name, directory + 46)
      offset += 30 + entry.name.length + entry.data.length
      directory += 46 + entry.name.length
    }

    view.setUint32(directory, 0x06054b50, true)
    view.setUint16(directory + 8, entries.length, true)
    view.setUint16(directory + 10, entries.length, true)
    view.setUint32(directory + 12, directorySize, true)
    view.setUint32(directory + 16, localSize, true)
    return archive
  }

  private static checksum(bytes: Uint8Array): number {
    let checksum = 0xffffffff
    for (const byte of bytes) {
      checksum ^= byte
      for (let bit = 0; bit < 8; bit++) {
        checksum = (checksum >>> 1) ^ ((checksum & 1) ? 0xedb88320 : 0)
      }
    }
    return (checksum ^ 0xffffffff) >>> 0
  }
}
