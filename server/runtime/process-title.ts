/**
 * What a running silo calls itself in the operating system's process list.
 */
export class ProcessTitle {
  /** The listen address rather than the data directory: instances are told
   *  apart by either, and this one stays short enough to survive the length
   *  cap a title inherits from the argv block it overwrites. 
   */
  static format(listen: string): string {
    return `silo ${listen}`;
  }

  /**
   * Names this process, or leaves it as it was.
   */
  static set(listen: string): void {
    try {
      process.title = ProcessTitle.format(listen);
    } catch {
      // Cosmetic. See above.
    }
  }
}
