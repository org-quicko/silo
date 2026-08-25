import type { Storage } from "../ports/storage";
import type { Entry } from "../domain/entry";
import { Scope } from "../domain/scope";
import { ValidationError } from "@silo/shared/validation-error";
import { FormatVersion } from "./format-version";
import type { ExportManifest } from "./export-manifest";
import { Importer } from "./importer";
import type { ScopedImport } from "./import-walker";
import type { ImportResult } from "./import-result";
import type { ScopeCopyOptions } from "./scope-copy-options";

/**
 * Copies one scope's schemas and entries onto another scope of the **same
 * instance** — the env→env move an archive round trip used to be the only way
 * to make (D22).
 *
 * It owns no merge logic of its own. `Importer.executeImport` already takes
 * `{manifest, scopes}` in memory rather than a directory, so this class only
 * has to read the source scope out of `Storage` into the same `ScopedImport`
 * shape `ImportWalker` produces from an archive. Merge/replace, `prefer`, and
 * dry-run therefore have exactly one implementation, and a change to import
 * semantics cannot silently diverge from copy semantics.
 *
 * Media is deliberately untouched: blob storage is instance-global and
 * unscoped, so there is no per-scope subset of it to move.
 */
export class ScopeCopier {
  static async copy(
    store: Storage,
    from: Scope,
    to: Scope,
    opts: ScopeCopyOptions,
  ): Promise<ImportResult> {
    ScopeCopier.validate(from, to);

    const meta = await store.meta();
    // `instance_id` is read from the same instance on both sides, so the
    // importer's last-resort tiebreak (`manifest.instance_id > local`) is
    // false and an entry identical in `updated_at` and `rev` is skipped.
    // That is the right answer here: nothing distinguishes the two copies.
    const manifest: ExportManifest = {
      format_version: FormatVersion,
      instance_id: meta.instance_id,
      last_seq: meta.last_seq,
    };

    const scoped = await ScopeCopier.read(store, from, to);
    return Importer.executeImport(store, { manifest, scopes: [scoped] }, opts);
  }

  private static validate(from: Scope, to: Scope): void {
    if (from.isSystem() || to.isSystem()) {
      throw new ValidationError("the system scope cannot be copied from or into");
    }
    if (from.equals(to)) {
      throw new ValidationError(
        `source and destination are the same scope ("${from.key()}")`,
      );
    }
  }

  /**
   * Reads `from` into an import unit addressed at `to`. Entries are
   * re-enveloped onto the destination scope, the same rule `ImportWalker`
   * applies to an archive: the address the caller named is authoritative and
   * the envelope's own `project`/`env` are overwritten from it (D18).
   */
  private static async read(store: Storage, from: Scope, to: Scope): Promise<ScopedImport> {
    const schemas = await store.listSchemas(from);
    for (const name of schemas.keys()) {
      if (ScopeCopier.isReserved(name)) schemas.delete(name);
    }

    // Enumerated independently of the schemas, exactly as `Exporter` does: an
    // earlier import can leave a collection holding entries and no schema,
    // and deriving the list from schemas alone would drop it.
    const names = [
      ...new Set([...schemas.keys(), ...(await store.listEntryCollections(from))]),
    ]
      .filter((name) => !ScopeCopier.isReserved(name))
      .sort();

    const entries = new Map<string, Entry[]>();
    for (const name of names) {
      entries.set(name, await ScopeCopier.readEntries(store, from, to, name));
    }
    return { scope: to, schemas, entries };
  }

  private static async readEntries(
    store: Storage,
    from: Scope,
    to: Scope,
    collection: string,
  ): Promise<Entry[]> {
    const items: Entry[] = [];
    let offset = 0;
    while (true) {
      const page = await store.list(from, collection, {
        sort: [{ path: "$.id", desc: false }],
        limit: 100,
        offset,
      });
      if (page.items.length === 0) break;
      for (const e of page.items) {
        items.push({ ...e, project: to.project, env: to.env });
      }
      offset += page.items.length;
    }
    return items;
  }

  /** System collections (`_keys`) are instance data, not a scope's content. */
  private static isReserved(collection: string): boolean {
    return collection.startsWith("_");
  }
}
