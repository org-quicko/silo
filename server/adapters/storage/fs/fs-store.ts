import fs from "fs/promises";
import path from "path";
import type { Storage } from "../../../core/ports/storage";
import type { DerivedIndex } from "../../../core/ports/derived-index";
import { EntryUtils } from "../../../core/domain/entry-utils";
import type { Entry } from "../../../core/domain/entry";
import type { Meta } from "../../../core/domain/meta";
import { Scope } from "../../../core/domain/scope";
import type { Query } from "../../../core/query/query";
import { NotFoundError } from "../../../core/errors/not-found-error";
import { MediaRefs } from "../../../core/media/media-refs";
import type { MediaUsage } from "../../../core/media/media-usage";
import { FormatVersion } from "../../../core/transfer/format-version";
import { EntryNodes } from "../../../core/query/entry-nodes";
import { FsFilter } from "./fs-filter";
import type { FsManifest } from "./fs-manifest";

export class FsStore implements Storage {
  private dir: string;
  private metadata: Meta;

  private constructor(dir: string, metadata: Meta) {
    this.dir = dir;
    this.metadata = metadata;
  }

  static async open(dir: string): Promise<FsStore> {
    const manifestPath = path.join(dir, "manifest.json");

    // Read and validate the manifest BEFORE creating anything: a refused
    // pre-D18 dir (format_version mismatch) must be left exactly as found,
    // not gain a stray `projects/` directory on the way to being rejected.
    let raw: string | undefined;
    try {
      raw = await fs.readFile(manifestPath, "utf8");
    } catch (err: any) {
      if (err.code !== "ENOENT") throw err;
    }

    let manifest: FsManifest;
    if (raw === undefined) {
      // Fresh data dir.
      manifest = {
        format_version: FormatVersion,
        instance_id: EntryUtils.newID(),
        last_seq: 0,
      };
      await fs.mkdir(path.join(dir, "projects"), { recursive: true });
      await FsStore.writeAtomic(manifestPath, JSON.stringify(manifest, null, 2));
    } else {
      manifest = JSON.parse(raw) as FsManifest;
      // A pre-D18 data dir stamps format_version "1" (flat layout). Reading
      // it as the new projects/<p>/<e>/... tree would silently find nothing
      // instead of failing loudly, so refuse it up front.
      if (manifest.format_version !== FormatVersion) {
        throw new Error(
          `this data directory uses format_version "${manifest.format_version}"; export with the previous binary and re-import, or start from a fresh data dir`
        );
      }
      await fs.mkdir(path.join(dir, "projects"), { recursive: true });
    }

    const store = new FsStore(dir, {
      instance_id: manifest.instance_id,
      last_seq: manifest.last_seq,
    });

    await store.repairManifestIfNeeded();
    return store;
  }

  async close(): Promise<void> {
    // Noop
  }

  private async repairManifestIfNeeded(): Promise<void> {
    const maxSeq = await FsStore.scanMaxSeq(path.join(this.dir, "projects"));

    if (maxSeq > this.metadata.last_seq) {
      this.metadata.last_seq = maxSeq;
      const manifest: FsManifest = {
        format_version: FormatVersion,
        instance_id: this.metadata.instance_id,
        last_seq: this.metadata.last_seq,
      };
      await FsStore.writeAtomic(
        path.join(this.dir, "manifest.json"),
        JSON.stringify(manifest, null, 2)
      );
    }
  }

  private static async scanMaxSeq(dir: string): Promise<number> {
    let maxSeq = 0;
    let entries: import("fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err: any) {
      if (err.code === "ENOENT") return 0;
      throw err;
    }

    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const sub = await FsStore.scanMaxSeq(full);
        if (sub > maxSeq) maxSeq = sub;
        continue;
      }
      if (!entry.name.endsWith(".json")) continue;
      try {
        const content = await fs.readFile(full, "utf8");
        const parsed = JSON.parse(content);
        if (parsed && typeof parsed.seq === "number" && parsed.seq > maxSeq) {
          maxSeq = parsed.seq;
        }
      } catch {
        // Corrupt file, skip
      }
    }
    return maxSeq;
  }

  private scopeDir(scope: Scope): string {
    return path.join(this.dir, "projects", scope.project, scope.env);
  }

  // project/env/collection/id all come from the path that located this file,
  // never from the file's own contents: the path is the addressing authority
  // (D18, same rule ImportWalker applies to archives). Trusting an envelope
  // that disagrees with its path would let `get` return an entry Service then
  // writes back under the wrong scope or collection — the file would live in
  // scopeA's directory while every layer above treats it as scopeB's, forking
  // the entry the next time it's saved. `id` is the same class of bug one
  // field over: a forged id made an entry that `list` returned but `get` and
  // `delete` could not find, which left the collection undeletable
  // (CollectionEraser lists, then deletes each id it was handed).
  private static parsedToEntry(scope: Scope, collection: string, id: string, parsed: any): Entry {
    return {
      id,
      project: scope.project,
      env: scope.env,
      collection,
      rev: Number(parsed.rev),
      seq: Number(parsed.seq),
      created_at: new Date(parsed.created_at),
      updated_at: new Date(parsed.updated_at),
      data: parsed.data,
    };
  }

  // ---- Projects and Environments ----
  //
  // A project or env can be created before it holds anything (D20), so
  // "exists" is no longer the same question as "has content". SQLite answers
  // it with rows in `projects`/`environments`; this adapter has only
  // directories, and a directory on its own is ambiguous — the tree is left
  // behind just the same when a scope's last schema and entry are deleted,
  // because nothing prunes it. Reading a bare directory as "exists" would
  // resurrect deleted scopes here that SQLite drops; reading it as "does not
  // exist" (what this adapter did before) silently loses explicitly created
  // empty projects, including from every export, since `Exporter` enumerates
  // `listScopes()`. A marker file written by the create call separates the
  // two, so both adapters agree: a scope exists exactly when it was created
  // explicitly or still holds content.
  //
  // Markers are dotfiles and live at the root of their own directory, so
  // `scanMaxSeq`, `scopeHasContent`, `listSchemas` and `listEntryCollections`
  // — all of which skip dotfiles or read only `schemas/`/`content/` — ignore
  // them without needing to know they exist.

  private static readonly ProjectMarker = ".silo-project";
  private static readonly EnvMarker = ".silo-env";

  private static async pathExists(p: string): Promise<boolean> {
    try {
      await fs.stat(p);
      return true;
    } catch (err: any) {
      if (err.code === "ENOENT" || err.code === "ENOTDIR") return false;
      throw err;
    }
  }

  // Written only when absent, mirroring SQLite's `INSERT OR IGNORE`: creating
  // an existing project must not reset its recorded creation time.
  private static async writeMarker(dir: string, name: string): Promise<void> {
    const marker = path.join(dir, name);
    if (await FsStore.pathExists(marker)) return;
    await FsStore.writeAtomic(marker, JSON.stringify({ created_at: EntryUtils.now().toISOString() }));
  }

  private async envExists(project: string, env: string): Promise<boolean> {
    const envDir = path.join(this.dir, "projects", project, env);
    if (await FsStore.pathExists(path.join(envDir, FsStore.EnvMarker))) return true;
    return FsStore.scopeHasContent(envDir);
  }

  private async projectExists(project: string): Promise<boolean> {
    const projectDir = path.join(this.dir, "projects", project);
    if (await FsStore.pathExists(path.join(projectDir, FsStore.ProjectMarker))) return true;
    for (const env of await FsStore.readSubdirs(projectDir)) {
      if (await this.envExists(project, env)) return true;
    }
    return false;
  }

  /** Child directory names, `_`-prefixed and dotfiles excluded. */
  // `_`-prefixed directories are the reserved system scope and stay out of
  // every listing that answers "what scopes exist". `includeReserved` is for
  // the one caller that must see them anyway: the media usage scan, which is
  // asking "does anything at all still reference this file" and would leave a
  // silent hole in the delete guard if it skipped a whole scope (D23).
  private static async readSubdirs(dir: string, includeReserved = false): Promise<string[]> {
    let entries: import("fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err: any) {
      if (err.code === "ENOENT" || err.code === "ENOTDIR") return [];
      throw err;
    }
    return entries
      .filter(
        (e) =>
          e.isDirectory() &&
          !e.name.startsWith(".") &&
          (includeReserved || !e.name.startsWith("_"))
      )
      .map((e) => e.name)
      .sort();
  }

  async createProject(project: string): Promise<void> {
    EntryUtils.assertSafeSegment(project, "project");
    const projectDir = path.join(this.dir, "projects", project);
    await fs.mkdir(projectDir, { recursive: true });
    await FsStore.writeMarker(projectDir, FsStore.ProjectMarker);
  }

  async listProjects(): Promise<string[]> {
    const projectsDir = path.join(this.dir, "projects");
    const names: string[] = [];
    for (const project of await FsStore.readSubdirs(projectsDir)) {
      if (await this.projectExists(project)) names.push(project);
    }
    return names;
  }

  async deleteProject(project: string): Promise<void> {
    EntryUtils.assertSafeSegment(project, "project");
    await fs.rm(path.join(this.dir, "projects", project), { recursive: true, force: true });
  }

  async createEnvironment(project: string, env: string): Promise<void> {
    EntryUtils.assertSafeSegment(project, "project");
    EntryUtils.assertSafeSegment(env, "env");
    // The project row is implied by the environment row in SQLite
    // (`createEnvironment` inserts both); mirror that here so a project
    // reached only through `createEnvironment` is listed by both adapters.
    const projectDir = path.join(this.dir, "projects", project);
    const envDir = path.join(projectDir, env);
    await fs.mkdir(envDir, { recursive: true });
    await FsStore.writeMarker(projectDir, FsStore.ProjectMarker);
    await FsStore.writeMarker(envDir, FsStore.EnvMarker);
  }

  async listEnvironments(project: string): Promise<string[]> {
    EntryUtils.assertSafeSegment(project, "project");
    const projectDir = path.join(this.dir, "projects", project);
    const names: string[] = [];
    for (const env of await FsStore.readSubdirs(projectDir)) {
      if (await this.envExists(project, env)) names.push(env);
    }
    return names;
  }

  async deleteEnvironment(project: string, env: string): Promise<void> {
    EntryUtils.assertSafeSegment(project, "project");
    EntryUtils.assertSafeSegment(env, "env");
    await fs.rm(path.join(this.dir, "projects", project, env), { recursive: true, force: true });
  }

  // ---- Schemas ----

  async putSchema(scope: Scope, collection: string, schema: any): Promise<void> {
    const filePath = path.join(this.scopeDir(scope), "schemas", `${collection}.schema.json`);
    await FsStore.writeAtomic(filePath, JSON.stringify(schema, null, 2));
  }

  async getSchema(scope: Scope, collection: string): Promise<any> {
    const filePath = path.join(this.scopeDir(scope), "schemas", `${collection}.schema.json`);
    try {
      const data = await fs.readFile(filePath, "utf8");
      return JSON.parse(data);
    } catch (err: any) {
      if (err.code === "ENOENT") {
        throw new NotFoundError(`collection "${scope.key()}/${collection}" not found`);
      }
      throw err;
    }
  }

  async listSchemas(scope: Scope): Promise<Map<string, any>> {
    const schemasDir = path.join(this.scopeDir(scope), "schemas");
    const out = new Map<string, any>();

    let entries: import("fs").Dirent[];
    try {
      entries = await fs.readdir(schemasDir, { withFileTypes: true });
    } catch (err: any) {
      if (err.code === "ENOENT") return out;
      throw err;
    }

    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;

      if (entry.name.endsWith(".schema.json")) {
        const colName = entry.name.slice(0, -".schema.json".length);
        const data = await fs.readFile(path.join(schemasDir, entry.name), "utf8");
        out.set(colName, JSON.parse(data));
      }
    }
    return out;
  }

  async deleteSchema(scope: Scope, collection: string): Promise<void> {
    const filePath = path.join(this.scopeDir(scope), "schemas", `${collection}.schema.json`);
    try {
      await fs.unlink(filePath);
    } catch (err: any) {
      if (err.code === "ENOENT") {
        throw new NotFoundError(`collection "${scope.key()}/${collection}" not found`);
      }
      throw err;
    }
  }

  // ---- Entries ----
  // collection/id (and project/env on put) are validated as safe path
  // segments here — a Storage port contract enforced identically by both
  // adapters (see storage.ts). This is the fs adapter's actual traversal
  // defense: without it, an import archive whose entry `id` is
  // "../../../../elsewhere/prod/content/posts/PLANTED" would resolve
  // straight through `path.join` into another scope, or outside the data
  // dir entirely.

  // `usages` is deliberately unused. The fs adapter keeps no reference index
  // at all: it derives usages by scanning entry files in `listMediaUsages`
  // (D23). An index would have to be either a new file type under `content/`
  // — which the export format is frozen against (D5) — or in-memory, and an
  // in-memory index goes stale the moment someone rsyncs or `git checkout`s
  // under a running process, which silently permits deleting a referenced
  // file. Scanning has no staleness window and is the O(n)-per-query
  // character §6.3 already commits this adapter to.
  // `_derived` is deliberately unused: the fs adapter keeps no index of either
  // kind. Usages are derived by scanning entry files at query time (D23), and
  // search is the same bargain (D30) — an on-disk index would break the frozen
  // layout (D5) and would go stale under an rsync or a `git checkout` beneath
  // a running process, which is precisely the staleness this adapter exists to
  // not have.
  async put(e: Entry, _derived: DerivedIndex): Promise<void> {
    EntryUtils.assertSafeSegment(e.project, "project");
    EntryUtils.assertSafeSegment(e.env, "env");
    EntryUtils.assertSafeSegment(e.collection, "collection");
    EntryUtils.assertSafeSegment(e.id, "id");

    this.metadata.last_seq++;
    e.seq = this.metadata.last_seq;

    const ej = {
      id: e.id,
      project: e.project,
      env: e.env,
      collection: e.collection,
      rev: e.rev,
      seq: e.seq,
      created_at: e.created_at instanceof Date ? e.created_at.toISOString() : e.created_at,
      updated_at: e.updated_at instanceof Date ? e.updated_at.toISOString() : e.updated_at,
      data: e.data,
    };

    const filePath = path.join(this.dir, "projects", e.project, e.env, "content", e.collection, `${e.id}.json`);
    await FsStore.writeAtomic(filePath, JSON.stringify(ej, null, 2));

    const manifest: FsManifest = {
      format_version: FormatVersion,
      instance_id: this.metadata.instance_id,
      last_seq: this.metadata.last_seq,
    };
    await FsStore.writeAtomic(
      path.join(this.dir, "manifest.json"),
      JSON.stringify(manifest, null, 2)
    );
  }

  async get(scope: Scope, collection: string, id: string): Promise<Entry> {
    EntryUtils.assertSafeSegment(collection, "collection");
    EntryUtils.assertSafeSegment(id, "id");

    const filePath = path.join(this.scopeDir(scope), "content", collection, `${id}.json`);
    try {
      const data = await fs.readFile(filePath, "utf8");
      return FsStore.parsedToEntry(scope, collection, id, JSON.parse(data));
    } catch (err: any) {
      if (err.code === "ENOENT") {
        throw new NotFoundError(`entry ${scope.key()}/${collection}/${id} not found`);
      }
      throw err;
    }
  }

  async delete(scope: Scope, collection: string, id: string): Promise<void> {
    EntryUtils.assertSafeSegment(collection, "collection");
    EntryUtils.assertSafeSegment(id, "id");

    const filePath = path.join(this.scopeDir(scope), "content", collection, `${id}.json`);
    try {
      await fs.unlink(filePath);
    } catch (err: any) {
      if (err.code === "ENOENT") {
        throw new NotFoundError(`entry ${scope.key()}/${collection}/${id} not found`);
      }
      throw err;
    }
  }

  async list(scope: Scope, collection: string, q: Query): Promise<{ items: Entry[]; total: number }> {
    EntryUtils.assertSafeSegment(collection, "collection");

    const colDir = path.join(this.scopeDir(scope), "content", collection);
    const entries: Entry[] = [];

    try {
      const files = await fs.readdir(colDir);
      for (const f of files) {
        if (f.startsWith(".") || !f.endsWith(".json")) continue;
        const content = await fs.readFile(path.join(colDir, f), "utf8");
        const id = f.slice(0, -".json".length);
        entries.push(FsStore.parsedToEntry(scope, collection, id, JSON.parse(content)));
      }
    } catch (err: any) {
      if (err.code !== "ENOENT") throw err;
      return { items: [], total: 0 };
    }

    // Filter
    const filtered: Entry[] = [];
    for (const e of entries) {
      if (q.filter) {
        const ok = FsFilter.evaluateFilter(e, q.filter);
        if (!ok) continue;
      }
      filtered.push(e);
    }

    const total = filtered.length;

    // Sort
    filtered.sort((a, b) => {
      if (q.sort) {
        for (const key of q.sort) {
          const valA = EntryNodes.sortValue(a, key.path);
          const valB = EntryNodes.sortValue(b, key.path);
          const cmp = EntryNodes.compare(valA, valB);
          if (cmp !== 0) {
            return key.desc ? -cmp : cmp;
          }
        }
      }
      return a.id.localeCompare(b.id);
    });

    // Paginate
    const limit = q.limit > 0 ? q.limit : 50;
    const offset = Math.max(q.offset, 0);

    if (offset >= filtered.length) {
      return { items: [], total };
    }

    const end = Math.min(offset + limit, filtered.length);
    return { items: filtered.slice(offset, end), total };
  }

  async listScopes(): Promise<Scope[]> {
    const projectsDir = path.join(this.dir, "projects");
    const scopes: Scope[] = [];

    for (const project of await FsStore.readSubdirs(projectsDir)) {
      for (const env of await FsStore.readSubdirs(path.join(projectsDir, project))) {
        // A directory pair alone doesn't mean the scope exists: fs never
        // prunes the tree, so deleting a scope's last schema and entry leaves
        // the directories behind. `envExists` is the shared rule — created
        // explicitly (marker) or still holding content — and it is what keeps
        // this in step with SQLite, whose `environments` row survives its
        // content the same way the marker does.
        if (!(await this.envExists(project, env))) continue;

        // A directory pair that doesn't conform to the id grammar (hand-
        // edited data dir, a bug elsewhere) must be skipped, not allowed to
        // crash every caller of listScopes() — export in particular.
        try {
          scopes.push(Scope.of(project, env));
        } catch {
          continue;
        }
      }
    }

    scopes.sort((a, b) => a.project.localeCompare(b.project) || a.env.localeCompare(b.env));
    return scopes;
  }

  // ---- Media usages (D23) ----
  // Derived by scanning, never indexed — see the note on `put`. Every entry
  // file in the tree is read once and run through the one shared extractor,
  // so this adapter and SQLite cannot disagree about what counts as a
  // reference. System collections are included: `_keys` holds no media, but
  // an entry is an entry and excluding a collection here would be a silent
  // hole in the delete guard.

  private async scanMediaUsages(wanted: Set<string>): Promise<MediaUsage[]> {
    const out: MediaUsage[] = [];
    const projectsDir = path.join(this.dir, "projects");

    for (const project of await FsStore.readSubdirs(projectsDir, true)) {
      for (const env of await FsStore.readSubdirs(path.join(projectsDir, project), true)) {
        const contentDir = path.join(projectsDir, project, env, "content");
        for (const collection of await FsStore.readSubdirs(contentDir, true)) {
          let files: string[];
          try {
            files = await fs.readdir(path.join(contentDir, collection));
          } catch {
            continue;
          }
          for (const file of files) {
            if (!file.endsWith(".json") || file.startsWith(".")) continue;
            let parsed: any;
            try {
              parsed = JSON.parse(await fs.readFile(path.join(contentDir, collection, file), "utf8"));
            } catch {
              continue; // a torn or hand-edited file is not a reference
            }
            const entryId = file.slice(0, -".json".length);
            for (const token of MediaRefs.extract(parsed?.data)) {
              if (wanted.has(token)) {
                out.push({ media_id: token, project, env, collection, entry_id: entryId });
              }
            }
          }
        }
      }
    }

    out.sort(
      (a, b) =>
        a.project.localeCompare(b.project) ||
        a.env.localeCompare(b.env) ||
        a.collection.localeCompare(b.collection) ||
        a.entry_id.localeCompare(b.entry_id)
    );
    return out;
  }

  async listMediaUsages(
    mediaIds: string[],
    opts: { limit?: number; offset?: number } = {}
  ): Promise<{ items: MediaUsage[]; total: number }> {
    if (mediaIds.length === 0) return { items: [], total: 0 };

    const all = await this.scanMediaUsages(new Set(mediaIds));
    const limit = opts.limit === undefined ? 50 : Math.max(0, opts.limit);
    const offset = Math.max(0, opts.offset || 0);
    return { items: all.slice(offset, offset + limit), total: all.length };
  }

  async countMediaUsages(mediaIds: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (mediaIds.length === 0) return out;

    for (const usage of await this.scanMediaUsages(new Set(mediaIds))) {
      out.set(usage.media_id, (out.get(usage.media_id) || 0) + 1);
    }
    return out;
  }

  async listEntryCollections(scope: Scope): Promise<string[]> {
    const contentDir = path.join(this.scopeDir(scope), "content");
    let colDirs: import("fs").Dirent[];
    try {
      colDirs = await fs.readdir(contentDir, { withFileTypes: true });
    } catch (err: any) {
      if (err.code === "ENOENT") return [];
      throw err;
    }

    const names: string[] = [];
    for (const col of colDirs) {
      if (!col.isDirectory()) continue;
      let files: string[];
      try {
        files = await fs.readdir(path.join(contentDir, col.name));
      } catch {
        continue;
      }
      // Same "has content" rule scopeHasContent applies: a directory left
      // behind by deleting a collection's last entry is not a collection, and
      // an in-flight `.<id>.json-<rand>.tmp` is not an entry.
      if (files.some((f) => !f.startsWith(".") && f.endsWith(".json"))) {
        names.push(col.name);
      }
    }
    names.sort();
    return names;
  }

  private static async scopeHasContent(scopeDir: string): Promise<boolean> {
    const schemasDir = path.join(scopeDir, "schemas");
    try {
      const files = await fs.readdir(schemasDir);
      if (files.some((f) => !f.startsWith(".") && f.endsWith(".schema.json"))) return true;
    } catch (err: any) {
      if (err.code !== "ENOENT") throw err;
    }

    const contentDir = path.join(scopeDir, "content");
    let colDirs: string[];
    try {
      colDirs = await fs.readdir(contentDir);
    } catch (err: any) {
      if (err.code === "ENOENT") return false;
      throw err;
    }

    for (const col of colDirs) {
      let files: string[];
      try {
        files = await fs.readdir(path.join(contentDir, col));
      } catch {
        continue;
      }
      if (files.some((f) => !f.startsWith(".") && f.endsWith(".json"))) return true;
    }
    return false;
  }

  async meta(): Promise<Meta> {
    return this.metadata;
  }

  static async writeAtomic(filePath: string, data: string): Promise<void> {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    const tmpPath = path.join(dir, `.${path.basename(filePath)}-${Math.random().toString(36).slice(2)}.tmp`);
    try {
      const fileHandle = await fs.open(tmpPath, 'w');
      await fileHandle.writeFile(data, 'utf8');
      await fileHandle.sync();
      await fileHandle.close();
      await fs.rename(tmpPath, filePath);
    } catch (err) {
      await fs.rm(tmpPath, { force: true }).catch(() => {});
      throw err;
    }
  }
}
