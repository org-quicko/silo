import type { MediaMode } from './media-mode'
import type { TransferProgress } from '../transport/progress-reader'

export interface CopyFromServerOptions {
  sourceUrl: string
  sourceApiKey: string
  mode: 'merge' | 'replace'
  withKeys: boolean
  dryRun: boolean
  prefer?: '' | 'local' | 'remote'
  /** `project[/env[/collection]]` rules. Empty is the whole instance. */
  include: string[]
  media: MediaMode
  /** Asks for the progress stream. A copy's connection is idle for the whole
   *  pull, so it is the operation a quiet-connection timeout kills most
   *  reliably (§7.8). */
  onProgress?: (progress: TransferProgress) => void
}
