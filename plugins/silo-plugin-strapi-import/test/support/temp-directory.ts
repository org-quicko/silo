import fs from 'fs/promises'
import os from 'os'
import path from 'path'

/** A scratch directory per test, cleaned up whether or not the test passed. */
export class TempDirectory {
  static async make(prefix: string): Promise<string> {
    return fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`))
  }

  static async remove(directory: string): Promise<void> {
    await fs.rm(directory, { recursive: true, force: true }).catch(() => {})
  }
}
