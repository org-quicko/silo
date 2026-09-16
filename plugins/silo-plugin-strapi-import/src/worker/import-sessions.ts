import crypto from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import type { SiloContext, SiloRequest, SiloRequestCaller } from 'silo:api'
import { ImportSession } from './import-session'
import type { PluginSettings } from './plugin-settings'

/** What a session directory remembers about itself, so a restart and the
 *  janitor can read it without the worker's memory. */
interface SessionRecord {
  key: string
  label: string
  touchedAt: string
}

/**
 * Every operator's import session, keyed by the caller silo authenticated.
 *
 * **The key is the caller's key id**, which is the only identity a plugin is
 * given (`SiloRequestCaller`) and the only one that survives a panel reload: a
 * panel runs in a sandboxed iframe with an opaque origin, so it has no storage
 * of its own to remember a session id in. Two people sharing one API key
 * therefore share one session, which is the honest boundary — silo models
 * identity as keys, not as users.
 *
 * Each session gets a directory of its own under `work_dir/sessions`, so
 * `SourceStore`'s sweep and `DELETE /files` can only ever reach the staging of
 * the operator who asked. An idle one is deleted after `session_ttl_hours`,
 * which is the lifetime the staging directory never had.
 */
export class ImportSessions {
  /** Under `work_dir`, one directory per session. */
  static readonly Directory = 'sessions'

  /** A caller id is a key's record id and already path-safe; anything else is
   *  hashed rather than sanitised, since two ids must never collapse into one
   *  session. */
  private static readonly SafeKey = /^[A-Za-z0-9_-]{1,64}$/

  /** Where a caller with no credential lands. These routes are not `public`, so
   *  this is the shape of a bug rather than an expected case. */
  private static readonly SharedKey = 'shared'

  private static readonly RecordFile = 'session.json'

  /** How often the record on disk is rewritten. Only the janitor reads it, so
   *  once a minute is as precise as it needs to be. */
  private static readonly TouchEveryMs = 60_000

  private readonly root: string
  private readonly settings: PluginSettings
  private readonly live = new Map<string, ImportSession>()
  private readonly written = new Map<string, number>()

  constructor(settings: PluginSettings) {
    this.settings = settings
    this.root = path.join(settings.workDir, ImportSessions.Directory)
  }

  /** The caller's session, created on first sight and marked in use. */
  of(request: SiloRequest): ImportSession {
    const key = ImportSessions.keyOf(request.caller)
    let session = this.live.get(key)
    if (!session) {
      session = new ImportSession({
        key,
        label: request.caller?.label ?? ImportSessions.SharedKey,
        directory: path.join(this.root, key),
        settings: this.settings,
      })
      this.live.set(key, session)
    }
    session.touch()
    void this.remember(session)
    return session
  }

  /** The key a caller's session lives under. */
  static keyOf(caller: SiloRequestCaller | null): string {
    const id = caller?.id ?? ''
    if (id.length === 0) return ImportSessions.SharedKey
    if (ImportSessions.SafeKey.test(id)) return id
    return crypto.createHash('sha256').update(id).digest('hex').slice(0, 32)
  }

  /**
   * Adopt what is on disk, and clear what predates sessions.
   *
   * The recovery is why this plugin declares a runtime at all: a worker restart
   * loses the map, and without this the panel would report no source while a
   * copy of the operator's database sat in the staging directory.
   */
  async recover(ctx: SiloContext): Promise<void> {
    await this.clearFlatLayout(ctx)

    for (const key of await this.directories()) {
      const record = await this.record(key)
      const session = new ImportSession({
        key,
        label: record?.label ?? key,
        directory: path.join(this.root, key),
        settings: this.settings,
        touchedAt: record ? Date.parse(record.touchedAt) : undefined,
      })
      await session.recover()
      this.live.set(key, session)
      const staged = session.store.current()
      if (staged) {
        ctx.log.info('found a Strapi source staged before this start', {
          session: key,
          path: staged.path,
          bytes: staged.bytes,
        })
      }
    }

    await this.sweep(ctx)
  }

  /** Delete every session idle past the configured lifetime. */
  async sweep(ctx: SiloContext): Promise<void> {
    const lifetime = this.settings.sessionTtlHours * 60 * 60 * 1000
    if (lifetime <= 0) return

    const now = Date.now()
    for (const key of await this.directories()) {
      const session = this.live.get(key)
      if (session?.busy()) continue

      const idle = session ? session.idleMs(now) : now - (await this.lastSeen(key))
      if (idle < lifetime) continue

      await fs.rm(path.join(this.root, key), { recursive: true, force: true }).catch(() => {})
      this.live.delete(key)
      this.written.delete(key)
      ctx.log.info('removed an idle Strapi import session', { session: key, idleMs: idle })
    }
  }

  /** Every session directory, whether or not this worker has seen it. */
  private async directories(): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.root, { withFileTypes: true })
      return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
    } catch {
      return []
    }
  }

  /** When a session nobody in this worker has opened was last used: its record,
   *  or the directory's own timestamp if it has none. */
  private async lastSeen(key: string): Promise<number> {
    const record = await this.record(key)
    const stamp = record ? Date.parse(record.touchedAt) : NaN
    if (Number.isFinite(stamp)) return stamp
    try {
      return (await fs.stat(path.join(this.root, key))).mtimeMs
    } catch {
      return 0
    }
  }

  private async record(key: string): Promise<SessionRecord | null> {
    try {
      const raw = await fs.readFile(path.join(this.root, key, ImportSessions.RecordFile), 'utf8')
      const record = JSON.parse(raw) as SessionRecord
      return typeof record?.touchedAt === 'string' ? record : null
    } catch {
      return null
    }
  }

  /** Write the session's record, at most once a minute. Best-effort: losing it
   *  costs the janitor a timestamp, and the directory's own mtime stands in. */
  private async remember(session: ImportSession): Promise<void> {
    const now = Date.now()
    const written = this.written.get(session.key) ?? 0
    if (now - written < ImportSessions.TouchEveryMs) return
    this.written.set(session.key, now)

    const record: SessionRecord = {
      key: session.key,
      label: session.label,
      touchedAt: new Date(now).toISOString(),
    }
    try {
      await fs.mkdir(session.directory, { recursive: true })
      await fs.writeFile(
        path.join(session.directory, ImportSessions.RecordFile),
        JSON.stringify(record, null, 2),
      )
    } catch {
      // An unwritable `work_dir` is reported where it matters, by the store that
      // could not stage the upload.
    }
  }

  /** Remove the staging of the version before sessions existed — a
   *  `source-*.db` and an `uploads/` directly under `work_dir`. It belongs to
   *  nobody now, and nothing will ever read it again. */
  private async clearFlatLayout(ctx: SiloContext): Promise<void> {
    let entries: string[]
    try {
      entries = await fs.readdir(this.settings.workDir)
    } catch {
      return
    }

    const stale = entries.filter(
      (entry) => entry === 'uploads' || (entry.startsWith('source-') && entry.endsWith('.db')),
    )
    if (stale.length === 0) return

    for (const entry of stale) {
      await fs
        .rm(path.join(this.settings.workDir, entry), { recursive: true, force: true })
        .catch(() => {})
    }
    ctx.log.info('cleared Strapi import staging from before sessions', { entries: stale.length })
  }
}
