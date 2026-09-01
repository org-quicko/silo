import fs from 'fs/promises'
import path from 'path'

/** What is staged, as the panel shows it. */
export interface StagedSource {
  /** The name the operator uploaded it as, for display only. */
  name: string
  bytes: number
  stagedAt: string
  /** The absolute path, so a run and a report cannot disagree about which file
   *  was read. Visible on purpose: the operator is the one who has to clean it
   *  up if they abandon a half-finished import. */
  path: string
}

/**
 * Where an uploaded `.db` lives while it is being read.
 *
 * On disk and not in memory, for one reason that decides it: `bun:sqlite` opens
 * a **file**, and a 64 MiB export held as bytes would have to be written
 * somewhere before it could be queried at all. So it is written once, read many
 * times — a plan, then a run, then a retry — and deleted when the operator says.
 *
 * **Not under the data directory.** A plugin has no business putting scratch
 * files in the one place silo promises is only the user's content (D5), and it
 * has no path to it in any case: `ctx` is the HTTP API, and a worker is told its
 * config rather than its instance's layout. The system temp directory is where a
 * staging file belongs, and `work_dir` is there for an operator whose temp
 * directory is too small for their export.
 */
export class SourceStore {
  /**
   * Staged files are `source-<n>.db`, and each upload gets a new `n`.
   *
   * Not one name overwritten, which is what this was and what made a second
   * upload fail. Replacing a file needs the old one gone, and on Windows a file
   * SQLite has read is not reliably deletable the instant its handle is closed —
   * so an upload that had already transferred every byte correctly failed
   * `EBUSY` on housekeeping. A fresh name never contends: the new upload lands
   * whatever is holding the old one, and the old one goes best-effort afterwards.
   *
   * "Best-effort" is the honest word, and it is why this is a *prefix* rather
   * than a growing set of names nobody prunes: `sweep` deletes every other
   * `source-*.db` on each upload and on recovery, so a file that was locked once
   * goes on the next pass rather than staying forever.
   */
  private static readonly Prefix = 'source-'
  private static readonly Suffix = '.db'

  /** The last `<n>` handed out, so the next one is always larger. Static, so
   *  two stores sharing a directory still cannot hand out the same name. */
  private static previousStamp = 0

  /**
   * The next `source-<n>.db`, where `<n>` is a base-36 millisecond stamp that
   * never repeats followed by four random characters.
   *
   * A bare `Date.now()` was a bug: two uploads inside one millisecond — which
   * is every pair that is not waiting on a human — produced the *same* name, so
   * the second silently overwrote the first instead of landing beside it, and
   * the sweep then had one file where the caller held two paths. The stamp is
   * carried forward a tick when the clock has not moved, which keeps names
   * distinct *and* sorted in write order — the whole of how `recover` picks the
   * newest. The random tail extends that across restarts, where a stamp the
   * process no longer remembers cannot be carried forward.
   */
  private static nextName(): string {
    SourceStore.previousStamp = Math.max(Date.now(), SourceStore.previousStamp + 1)
    const tail = Math.trunc(Math.random() * 36 ** 4)
      .toString(36)
      .padStart(4, '0')
    return `${SourceStore.Prefix}${SourceStore.previousStamp.toString(36)}-${tail}${SourceStore.Suffix}`
  }

  /**
   * Public, because `UploadStore` stages Strapi's uploads under the same root and
   * the two have to agree about where it is — resolved once by `PluginSettings`
   * rather than derived twice, where a restart could recover half a state.
   */
  readonly directory: string
  private staged: StagedSource | null = null

  constructor(directory: string) {
    this.directory = directory
  }

  current(): StagedSource | null {
    return this.staged
  }

  /** The staged file, or a refusal saying to upload one — which is the answer
   *  every route but the upload needs, phrased once. */
  require(): StagedSource {
    if (!this.staged) {
      throw new Error('no Strapi database has been uploaded yet')
    }
    return this.staged
  }

  /**
   * Stage an upload and make it the current source.
   *
   * A fresh name from `nextName`, a direct write, then a best-effort sweep of
   * everything older. Nothing is renamed and nothing is overwritten: the name is
   * new every time, so there is no destination to clear first, and a
   * write-then-rename would buy no atomicity that writing to an unused path does
   * not already have.
   *
   * That is also what keeps a reader safe mid-upload. The file already staged is
   * untouched until the sweep, so a request arriving during the write is handed
   * the old source rather than a path that is briefly missing, and `staged` only
   * moves once the new file is whole. Why the name is new each time rather than
   * reused is on `Prefix` above.
   */
  async put(name: string, bytes: Uint8Array): Promise<StagedSource> {
    const target = path.join(this.directory, SourceStore.nextName())

    try {
      // `mkdir` is inside the try, not before it: an unusable `work_dir` fails
      // here rather than at the write, and a raw ENOTDIR is not an answer an
      // operator can act on.
      await fs.mkdir(this.directory, { recursive: true })
      await fs.writeFile(target, bytes)
    } catch (caught: any) {
      throw new Error(
        `the upload could not be staged in "${this.directory}": ${caught?.message ?? caught}. ` +
          `Set "work_dir" in this plugin's configuration to a directory it can write.`,
      )
    }

    this.staged = {
      name,
      bytes: bytes.byteLength,
      stagedAt: new Date().toISOString(),
      path: target,
    }
    await this.sweep(target)
    return this.staged
  }

  /** Delete every staged file except `keep`. Best-effort: one that is still held
   *  goes on the next pass, and a directory that cannot be read is not this
   *  request's problem. */
  private async sweep(keep: string | null): Promise<void> {
    let entries: string[]
    try {
      entries = await fs.readdir(this.directory)
    } catch {
      return
    }
    for (const entry of entries) {
      if (!entry.startsWith(SourceStore.Prefix) || !entry.endsWith(SourceStore.Suffix)) continue
      const full = path.join(this.directory, entry)
      if (keep !== null && full === keep) continue
      await fs.rm(full, { force: true }).catch(() => {})
    }
  }

  /** Forget and delete, the staged file and any leftovers alike. A missing file
   *  is a success: the outcome asked for is "it is not there". */
  async clear(): Promise<void> {
    this.staged = null
    await this.sweep(null)
  }

  /**
   * Adopt a file already at the staging path.
   *
   * What makes a restart survivable. A worker restart loses `staged`, and the
   * file it describes is still on disk — so the alternative to this is an
   * operator re-uploading 64 MiB because a plugin was restarted, with a stale
   * copy of their database left behind either way.
   */
  async recover(): Promise<StagedSource | null> {
    let entries: string[]
    try {
      entries = await fs.readdir(this.directory)
    } catch {
      return null
    }

    // Newest wins, by name — `<n>` leads with a base-36 timestamp of a fixed
    // width, so the names sort the way they were written. Then the rest are
    // swept, which is where a file locked during an earlier upload finally goes.
    const staged = entries
      .filter((entry) => entry.startsWith(SourceStore.Prefix) && entry.endsWith(SourceStore.Suffix))
      .sort()
      .pop()
    if (!staged) return null

    const target = path.join(this.directory, staged)
    try {
      const stat = await fs.stat(target)
      if (!stat.isFile()) return null
      this.staged = {
        name: staged,
        bytes: stat.size,
        stagedAt: stat.mtime.toISOString(),
        path: target,
      }
    } catch {
      return null
    }
    await this.sweep(target)
    return this.staged
  }
}
