/** Human-readable file sizes. */
export class ByteSize {
  private static readonly Units = ['KB', 'MB', 'GB', 'TB']

  static format(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`

    let value = bytes / 1024
    let unit = 0
    while (value >= 1024 && unit < ByteSize.Units.length - 1) {
      value /= 1024
      unit++
    }
    return `${value.toFixed(1)} ${ByteSize.Units[unit]}`
  }
}
