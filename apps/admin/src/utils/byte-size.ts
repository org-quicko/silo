/** Human-readable file sizes. */
export class ByteSize {
  static format(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`

    const kilobytes = bytes / 1024
    if (kilobytes < 1024) return `${kilobytes.toFixed(1)} KB`
    return `${(kilobytes / 1024).toFixed(1)} MB`
  }
}
