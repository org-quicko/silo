/** A file, or an empty folder, the server would not take, and what it said. */
export interface MediaUploadRefusal {
  /** Relative to the destination, as the reader's own folder spelled it. */
  path: string
  message: string
}

/**
 * How an upload ended. `total` and `uploaded` count files. `stopped` is why
 * the run gave up before its end (the network, a credential, the server), and
 * is null when it went through every item, refused or not.
 */
export interface MediaUploadReport {
  total: number
  uploaded: number
  refused: MediaUploadRefusal[]
  stopped: string | null
}
